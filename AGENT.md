# Mingshen Harness 开发交接与维护记录

最后核对日期：2026-11-24（Asia/Shanghai）。适用工作区版本：1.3.6。

本文供其他智能体、开发者和新对话接续工作，记录开发经过、已确认约束、实际代码位置、验证边界和打包方法。它不是功能全部完成、无漏洞或安装包已验收的证明。任何接续工作先核对当前源码、用户最新指令和 `git status`，不要直接照搬早期计划。

## 1. 接手时先做什么

1. 阅读本文和 [README.md](README.md)，涉及安全时阅读 [SECURITY.md](SECURITY.md)。
2. 执行 `git status --short`，了解已有修改；本交接时工作区有大量未提交修改和未跟踪文件，包含有效实现，不是可直接清理的废料。
3. 按任务阅读对应模块及相邻测试。优先小范围修复，沿用现有 Electron、React、TypeScript 和 pnpm 结构。
4. 先阅读 [1.3.6 验证记录](docs/VALIDATION_1.3.6.md)和 [1.3.5 验证记录](docs/VALIDATION_1.3.5.md)；历史行为参考 [1.3.4 验证记录](docs/VALIDATION_1.3.4.md)、[1.3.3 验证记录](docs/VALIDATION_1.3.3.md)、[1.3.2 验证记录](docs/VALIDATION_1.3.2.md)、[1.3.1 验证记录](docs/VALIDATION_1.3.1.md)、[1.3.0 验证记录](docs/VALIDATION_1.3.0.md)、[1.2.9 验证记录](docs/VALIDATION_1.2.9.md)、[1.2.8 工作区验证](docs/VALIDATION_1.2.8.md)、[1.2.7 计划生命周期与附件验证](docs/VALIDATION_1.2.7.md)、[1.2.6 任务工作台与执行验证](docs/VALIDATION_1.2.6.md)、[1.2.5 菜单、首次引导、日志与上下文验证](docs/VALIDATION_1.2.5.md)、[1.2.4 验证](docs/VALIDATION_1.2.4.md)、[1.2.3 验证记录](docs/VALIDATION_1.2.3.md)、[1.2.2 验证记录](docs/VALIDATION_1.2.2.md) 和 [1.2.1 全量记录](docs/FULL_VALIDATION_1.2.1.md)，区分历史结果、模拟验证、真实集成和未验证项目。
5. 完成后记录改了什么、执行了什么、结果及剩余边界；变更协议、打包、数据结构或安全边界时同步本文和对应文档。

当前工作区目标版本为 1.3.6。生图画布库、参考图、后台生图、素材提示词恢复及批量素材管理均已完成；删除素材会同步清理绑定提示词记录，当前工作区提示词保持不变。手动导入/拖放和批量 ZIP 导出分别采用独立的 500 MiB 合计预算，导出有素材数/字节进度。Windows 安装把内置提示词树放入 app.asar 并逐项 SHA 复核，保留默认 7z 暂存解压与复制重试。最新完整串行 Vitest：205个测试文件，202通过、3环境跳过；2,827项通过、15项跳过、0失败。根 Node 脚本163项、类型检查、Biome 529文件、生产构建和13,871项资源预检通过；批量 ZIP Electron 场景验证了进度条、5阶段 IPC、ZIP 内容与源图 SHA。完整工作台 smoke 两次在后续异步界面等待处超时，不记作全绿，细节见[1.3.6验证记录](docs/VALIDATION_1.3.6.md)。随包文档冻结后的 1.3.6 NSIS/ZIP 已于2026-11-24重建并独立核验，精确数据见第90节。安装、升级和卸载未验收，未发布、未提交；发布 SQL 已准备但 HTTPS 下载链接仍是执行前须替换的占位符，没有执行云 SQL。1.3.4、1.3.5及更早版本的功能、验证和历史边界仍以源码及各版本验证记录为准；本交接后续章节保留完整历史。

1.3.0 包含内置 DOCX/PPTX/PDF、按 profile 配置子模型、原生 Responses 状态、图片工具、管道命令、分页读取/受控并发、父会话验证转交与 Token Saver 质量默认值；随后补充模型首次预填、K/M 数值输入、供应商连接编辑和 TencentDB 记忆库。最新工作区记忆设置及模型语义提取见第30节，取代历史离线规则摘录；官方提示词逐字对齐与真实请求核验见第31节。第二套“光轨”界面保留默认“简约”，按已确认预览重构为独立工作台，独立结构见第26节，最新材质打磨及主界面模型/供应商标签见第27节；第24节为首次接入历史。选择自动保存、重载或重启生效，共用全部业务功能。运行信息展开/收起、完整诊断与命令详情见第25节，并在独立结构中回归。各轮实际结果和未验证边界见 [1.3.0 验证记录](docs/VALIDATION_1.3.0.md)。主会话窗口15%的压缩输出预算及触顶恢复、TencentDB 本地记忆核心及项目二选一、工具参数流与 UTF-16 读写修复、缓存前缀优化与诊断、供应商缓存配置、同模型压缩复用、提问/修改冲突通知、Token Saver、执行链、项目记忆、自动重试及剪贴板图片附件见 [1.2.9 验证记录](docs/VALIDATION_1.2.9.md)；下方历史版本结果不能替代本轮验证。

最新 ChatAgent 分组快速新建见第66节：同组加号直接沿用最近更新的未归档 Chat 配置创建空白对话，不再显示完整新建弹窗。稳定性修复全量回归与本轮快速新建定向验证分别记录，不把第65节的2001项作为本轮最终代码重新全量验证的结果。

最新全仓审查清单、粘贴原文修复及ChatAgent联网开关已完成本地集成验证，见第67、68节和[1.3.4验证记录](docs/VALIDATION_1.3.4.md)：联网开关最终源码下完整串行Vitest为155文件、2121项通过，另有3文件、14项环境跳过；独立联网Electron smoke 3/3通过，完整工作台smoke另有任务面板复载断言超时，不能宣称全工作台smoke通过。项目来源、LSP、编辑重发事务、附件预算、文档包与嵌入工作簿、宿主命令、ACP及本地预览均按实际入口重新核对。

文件名说明：用户指定的主要交接文件是本 `AGENT.md`；根目录 `AGENTS.md` 是自动发现入口，指向本文。不要复制维护两份正文。

最新工作面与项目协作扩展见第69节：348个工作流模板、生图与可移植画布、只读AutoDrive、18角色协同总控、统一命令面板、真实多标签Shell、逐行评论、分支/worktree导航及草稿辅助已集成。工作站空章节与写入失败恢复、交接冲突去重和异步目标复核已补齐；最终验证继续以[1.3.4验证记录](docs/VALIDATION_1.3.4.md)“创作工作面与项目协作扩展”节为准，不复用第68节数字。PNG/JPEG/WebP/GIF素材做有界完整解码，APNG暂不支持；新增原生依赖、组件许可表和生产依赖闭包均纳入打包检查。

运行中引导的最新接续入口见第70节。它向同一次运行的后续模型请求加入普通用户文字，与当前运行正常结束后才派发的下一轮队列分别处理；不能中途改写已经发出的模型请求或撤回已开始的工具操作。本轮最终证据单独追加到[1.3.4验证记录](docs/VALIDATION_1.3.4.md)，不复用第69节的测试数字。

工作站模板库、内置 Skill 版本合并及 Code/Work 侧栏空白的最新接续入口见第71节。工作站已从第69节的初版扩至780个独立场景，简略与详细是同一场景的两个提示词版本，不另增场景数。用户入口和交付范围见[工作站模板说明](docs/WORKSTATION_TEMPLATES.md)。

最新续接已补充 Code/Work 内置专业工作流、Office 设计预设和受控版式、全部启用扩展的按需发现，以及独立 Chat 快捷窗口；两项全局快捷键已移入设置，可录制 Ctrl/Shift/Alt 组合、实际注册并检测占用。主窗口与快捷窗口共用草稿时新增 revision 冲突保护及明确恢复操作。见第55节，最新实际检查及未验证项继续以[1.3.4验证记录](docs/VALIDATION_1.3.4.md)追加部分为准，不把前轮数字用于证明本轮修改。

本地插件开发市场、原生清单/SDK/创建器、用户提供的 Work 技能流适配、SubAgent 无固定总时限和后台协作、小窗切换及持久置顶已进入源码，见第56节及[本地插件接口](docs/LOCAL_PLUGINS.md)。来源覆盖清单与运行时技能数量分别记录，不把兼容清单或源码资源存在当成第三方插件已验收。

最新本地插件错误、逐次模型请求 Hook、更新轮询和网页请求预算修复见第76节及[1.3.5验证记录](docs/VALIDATION_1.3.5.md)。全量Vitest仍有7项Windows junction夹具 `EPERM`，不可写作全绿；定向测试、类型、Lint、构建、Electron插件smoke与资源预检分别记录。

最新插件开发故障修复及 Work 技能全版本补齐见第57节：统一发现入口包含内置技能，主 Code/Work 宿主请求批准会话可使用只读插件校验，不再依赖沙箱外 SDK 或系统 Node；`WorkAgentSkill/` 全树实际为124个物理来源、104个不同源正文SHA、93个名称。第56节此前98份是只统计latest系列的历史结果，不是全树总数。来源逐项映射见[完整清单](apps/desktop/resources/prompts/skills/work-sources/inventory.md)，最终验证仍以[1.3.4验证记录](docs/VALIDATION_1.3.4.md)本轮追加部分为准。

内置Skill/Plugin的手动引用、Work专属PPTMaster与ASD-STE100，以及参考T3 Code的下一轮队列初版见第58节；队列现已按用户最新要求升级为最多10条、正常完成后自动FIFO发送，见第62节，取代第58节的8条及手动继续行为。Code基础Skill仍为9个，Work为16个基础Skill加124个来源；两种模式各另有2个真实内置插件目录项。主界面Code/Work/Chat均支持队列，QuickChat和实际SubAgent不提供队列。最终检查以验证记录的最新追加结果为准。

仓库忽略规则及新仓库准备检查见第44节，面向公开仓库访客的 README 调整见第45节；首页提供产品能力、快速开始与开发入口，内部留档过程继续保留在本文及版本验证记录中。

### 必须保留的仓库约束

- 不擅自重建项目、迁移框架、移动模块、创建替代仓库或改变包管理器。
- 不执行 `git reset --hard`、`git checkout --`、`git clean -fd` 等丢弃现有工作的命令；不把已有未跟踪源码当临时文件删除。
- 未经明确请求不提交、推送、发布 GitHub Release、不执行云端 SQL、不生成或安装正式安装包。`--dir` 解包验证与正式 NSIS 安装包是两个不同操作。
- 用户最新指定版本为 **1.3.6**；最新 NSIS/ZIP 已于2026-11-24 在随包文档冻结后本地重建并核验，SHA-256和大小见第90节。1.3.6 发布 SQL 已生成，但公开 HTTPS 下载链接仍为待替换占位；SQL 未执行。尚未安装或验收升级/卸载，也未上传或发布。后续仍须获得明确要求才进行安装或发布。
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
| 应用版本 | 根 `package.json`、桌面 `package.json`、`apps/desktop/src/shared/release.ts` 中的 1.3.6 |
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
| `apps/desktop/src/main/storage/` | SQLite、Repository、safeStorage 密文；当前 schema version 9，保留本地FTS/游标分页/变更序号及全部历史迁移 |
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

`run-experimental.cmd` 会自动寻找 Node/pnpm，缺依赖时安装依赖；每次启动都先核验固定原生沙箱、准备 Electron 并重新构建当前源码，任一步失败即停止，不启动旧构建。准备脚本还会校验 ICO、必要时从同目录同名 PNG 恢复并生成专用实验 EXE；无需因已有 `out/main/index.js` 再手动补一次构建。正常退出托盘中的旧测试进程后再验证，不能擅自终止用户任务。

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
Set-Location -LiteralPath 'C:\Users\ASUS\Desktop\MingshenHarness'
.\package-win.cmd --check
```

只有用户要求生成正式安装包时执行：

```powershell
.\package-win.cmd
```

| 命令 | 行为 |
| --- | --- |
| `.\package-win.cmd --check` | 查找 Node/pnpm，检查 Electron Windows 运行时及随包资源（含 TencentDB 记忆核心、许可/清单、文档 worker、Office COM 脚本、Chat/Work 提示词、全部内置技能及来源目录、PPTMaster/ASD-STE100 资源、插件 SDK、双语内嵌文档和 TypeScript 索引解析器）、源码/运行资源哈希与依赖闭包、离线 OCR/原生依赖和版本；不下载或构建，资源数量以本次预检输出为准 |
| `.\package-win.cmd --dir` | Electron 准备、图标、原生运行时、生产构建、预检、完整解包构建和 afterPack；不创建 NSIS 安装包 |
| `.\package-win.cmd` | 同上并创建 NSIS 安装包；复制最终发布文件回项目 |
| `pnpm package:win` | pnpm 已可用时的正式安装包等效入口，同样使用仓库打包包装脚本 |

版本 1.3.6 的预期输出（1.3.5 及更早历史版本发布材料保留）：

```text
apps\desktop\release-artifacts\MingshenHarness-1.3.6-x64.exe
apps\desktop\release-artifacts\MingshenHarness-1.3.6-x64.zip
apps\desktop\release-artifacts\MingshenHarness-1.3.6-x64.zip.sha256
apps\desktop\release-artifacts\MingshenHarness-1.3.6-x64.zip.json
```

实际构建目录由脚本创建：

```text
%LOCALAPPDATA%\MingshenHarness\BuildCache\windows-1.3.6-<random>\
  electron\                  临时原版运行时，结束后受限清理
  temp\                      构建子进程的 TEMP/TMP
  output\win-unpacked\      完整应用目录
  output\MingshenHarness-1.3.6-x64.exe
```

`--dir` 是可选的解包验证，不是生成安装包前必须单独执行的步骤。它会打印可运行 EXE 的绝对路径；正式打包会打印项目输出及 `Cached installer:`。如果安装包构建成功、只是复制回项目输出目录失败，使用控制台提示的缓存文件。ZIP、SHA256 及 JSON 各自复制失败时会显示 `Update artifact retained in build cache:`，需分别核对实际路径，不能仅凭退出0断定所有文件已复制回项目。构建失败时打印 `Build files retained for diagnostics:`；该目录不一定有成功安装包，先看构建退出码及目标文件，不要再次全盘清理重装。

源码预检还会与根目录的 `WorkAgentSkill/`、`ppt-master/`、`asd-ste100-skill-master/` 核对来源及哈希，打包前需保留这些来源目录和 `apps/desktop/resources/prompts/skills/` 内的完整副本。安装后的应用使用随包副本，不要求用户保留开发仓库或这些来源目录。

### 6.2 打包调用链

`package-win.cmd` -> 根/桌面 `package:win` -> `provision-electron-runtime.cjs` -> `generate-icon.ps1` -> `provision-native-runtime.mjs` -> `pnpm build` -> `package:check` -> `scripts/package-windows.cjs` -> `package-native-dependencies.cjs`（验证node-pty官方预编译、官方重编其余依赖）-> electron-builder（仅关闭重复重编）-> `scripts/check-package.cjs` afterPack。

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
| `scripts/package-native-dependencies.cjs` | 校验node-pty1.1.0的7份官方x64预编译哈希和加载优先级，按打包器自身解析的官方rebuild重编其余生产/可选模块，失败不启动builder；重编前后核对全部同名实例及目录集合 |
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
- `tools/persistent-command-service.ts`提供run/session/security-scope绑定的`exec_command`/`write_stdin`管道会话，支持增量输出、stdin、EOF、停止及受管进程收尾；不是PTY。清理未确认保留commandEffects、writer屏障和lease，不得先释放；本节记录的1.3.0当时对已结束句柄的cleanup失败不自动重试，1.3.4已支持后续终止请求或run cleanup重试，见第65节；清屏障不能代替确认进程/容器停止及核实副作用。宿主故意detached/`Start-Process`后原父提前退出，不保证跟踪全部脱离后代；不能宣称任意daemon都有OS级清理保证。
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

## 51. 2026-11-14 / 1.3.3 光轨企业工作台升级与输入预览修复

用户要求研究企业级 Agent 的界面布局，全面升级光轨主题的质感、界面和动效，版本升至1.3.3，并修复输入时“编辑原文”自行跳到“格式预览”的问题。本轮保持现有 Electron/React/TypeScript 结构、原子图标、业务数据和权限边界；未替换组件库，未新增依赖。

界面升级集中在`orbit-workbench.css`末尾的1.3.3层：统一面板、标题、侧栏、会话、执行时间轴、审查、终端和任务区的表面层级与1px边框；降低装饰性渐变、泛光和阴影，保留冰白矿青、窄光轨和原子图标。输入框成为唯一抬升的对话表面；运行节点、状态栏、流式消息、详情展开和设置层使用短时、状态导向的动效。键盘焦点和减少动效路径同步补齐。调研方向参考企业级 Agent/工作台普遍采用的“导航退后、状态与数据在前、人类审批在任务上下文内、动效解释状态”原则；当前环境网络抓取不可达，未将未实际读取的网页作为证据引用。

输入预览问题在`ChatView.tsx`修复：仅当浏览器明确报告`insertFromPaste`/`insertFromPasteAsQuotation`，且对应粘贴仍处于等待状态时打开预览；普通键入、IME组合输入、过期粘贴标记和预览内快捷键都不会再自动切换。新增`composer-input.ts`纯函数及单元测试，保留预览内容仍使用原始Markdown/LaTeX发送。

版本已同步至根/桌面`package.json`、`release.ts`、`mingshen-acp.mjs`、启动/打包提示、README、双语文档、协议适用版本、第三方说明、SECURITY及AGENT。历史1.3.2安装包、发布SQL、哈希和大小不变。新增[1.3.3验证记录](docs/VALIDATION_1.3.3.md)，记录本轮实际检查、失败重跑和未覆盖范围。

最终源码检查：Node/Web TypeScript通过，Biome329文件通过（633ms），定向Vitest3文件14项通过；生产构建main112/preload3/renderer2237模块、25份固定TencentDB源哈希及CSS 314.03kB通过；`node scripts/check-package.cjs --source`通过33资源、生产依赖和1.3.3版本。真实Electron输入专项11/11组通过（8截图、1次本地请求、无异常）；光轨工作台专项12/12组通过（13次本地请求、2次worker、30截图、无renderer异常）；长时间历史专项11/11组通过（0布局问题、48测量、13截图、无异常/崩溃），1440空闲输入P95 9.1ms、流式输入P95 61.8ms且均0长任务。首次完整Vitest并行运行130文件1615项中4项因Windows临时目录超时/EBUSY失败；串行重跑4文件95项全部通过，保留首次失败并记录为环境并发边界，不宣称全部并行环境稳定。

实际查看1440夜间运行/空态、日间完成态及800紧凑态截图，未发现阻断性遮挡或水平溢出；800抽屉截图的明暗对比受透明叠加/截图时序影响，未作为产品主题结论。未生成1.3.3 NSIS/ZIP、未安装/升级、未访问用户正常数据或付费服务、未提交/推送。外部企业Agent网页抓取在环境内超时，未伪造引用；方向依据本地企业应用方向库与现有DESIGN.md。

## 52. 2026-11-15 / 1.3.3 DOCX 旧稿局部编辑与精细排版

用户要求优化文档处理和排版，解决此前必须预埋占位符才能替换旧稿区段的限制。本轮沿用`create_document`、现有文档依赖和受控文件网关，版本保持1.3.3、schema8及协议修订号`2026-11-04.3`；不新增依赖、不迁移框架、不修改用户数据和图标。

新增`src/main/documents/document-edit.ts`及对应测试。`read_document`/`read_file`的`structure:true`返回DOCX源SHA-256、正文block和含表格单元格的paragraph编号；`create_document.edit`要求该SHA，支持`replace_text`跨run唯一文字替换、`replace_blocks`完整正文段落/表格区间替换或删除，以及`format_paragraph`。一次最多100项，全部按原始快照定位，拒绝重叠、歧义、源hash变化和不支持的目标，不提交半份结果。默认另存，读取原稿独立检查profile权限、审批和隔离网关；覆盖、原子提交、并发冲突与取消边界沿用既有实现。

文字/排版/删除仅改变正文XML，其余包内部件保留原始字节；插入富内容可更新必要关系、样式、编号和脚注等，无关页眉、页脚、媒体、原图表及元数据按原部件保留。正文XML与ZIP会重新序列化，不能宣称任意Office文件无损或改字后分页完全不变。选区涉及书签、批注、跨段字段/权限范围、修订、内容控件、分节及脚注引用等时拒绝；签名/含宏文件拒绝。富内容插入要求标准`w:`前缀，其他前缀可做行内文字和段落排版。文档级`settings.xml`保护未单独做完整兼容验证，不能把选区守卫扩展为所有Office保护机制已验证。

DOCX/PDF新增`layout`控制对齐、段前/后磅值、倍数行距、英寸缩进、与下段同页、段中不分页及段前分页；表格`column_widths`采用相对比例，DOCX写入固定网格/单元格宽度，PDF使用列比例。旧稿/模板中的指定列宽表格按原稿实际正文尺寸计算，限尺寸明确的单节单栏正文。独立Word公式补齐`m:oMathParaPr/m:jc`，修复仅设置普通段落对齐却仍居中的问题；行内公式随文字，独立公式的justify按左对齐处理。PPTX明确拒绝新段落布局和结构化单元格参数。

最终定向Vitest：11文件通过/1文件跳过、193项通过/1项跳过（34.38秒）；Node/Web类型检查、Biome331文件、生产构建main113/preload3/renderer2237模块、25份固定TencentDB源哈希、33项资源/依赖/1.3.3预检通过。真实Electron文档专项18/18组通过，60次本地Agent请求、0辅助请求，9张截图；完整证据为`.impeccable/review/v133-document-authoring-1794752646597/`。检查原稿未变、未改部件保留、旧hash不写入、原生公式/脚注/关联，以及段落布局PDF。前一轮2项HTML断言因新增样式分号失败，改为仅有布局时追加样式后重跑通过；结果不与最终193项相加。

使用documents技能的标准渲染器尝试失败，环境缺少LibreOffice `soffice.exe`，不记为通过。改用本机Microsoft Word COM对6份生成夹具导出8页，实际逐页检查；验证正文/表格原生公式编辑保存重开、旧稿页眉/页脚/图片/脚注保留、18pt首行缩进、8pt段后、1.5倍行距、两端对齐、段中不分页、3:1列宽及独立公式左对齐。首轮Word视觉检查发现公式居中问题后修正并完整重跑，最终`word-render/result.json`记录`equationJustification:3`。工具生成的8页PDF和1张语义预览也已查看，无阻断性裁切或重叠；语义HTML不充当Word版面证明，Markdown嵌套列表已有偏大间距未在本轮重写。

提示词、README、中英文使用手册/更新日志、[文档工具说明](docs/DOCUMENT_TOOLS.md)及[1.3.3验证记录](docs/VALIDATION_1.3.3.md)同步。差异空白检查无错误，8份相关Markdown的114个本地文件目标存在。未执行本轮完整应用测试、ASAR专项、NSIS/ZIP、安装/升级、云SQL、付费模型或Git提交/推送；未认证完整Office/LibreOffice/第三方扩展兼容矩阵。正常退出旧实验实例后运行`.\run-experimental.cmd`使用已构建源码。

## 53. 2026-11-17 / 1.3.3 大型 Skill 导入与三模式调研

用户要求保持1.3.3，把原4,000文件的本地扩展上限提高到20,000；同时研究办公/开发Agent并加入CodeAgent、WorkAgent与独立ChatAgent。用户明确要求遇到模糊之处先提问。因此本轮仅落地独立的导入修复，三模式与办公增强的产品边界待答复；子任务返回的建议/问题不是用户确认，不能据此开始迁移或把模式标成已实现。

`extensions/extension-service.ts`的单扩展文件数改为20,000，将超限检查放在实际加入文件前，恰好达限后遇到空目录或被忽略目录不会误报。`marketplace/skill-marketplace-service.ts`的独立1,000文件上限同步改为20,000，错误明确显示数量；市场仍按远端全部blob保守计数，本地忽略既有目录。保留64MiB大小、单份技能正文32,000字符和扩展正文总预算120,000字符，未把资源全部加入模型上下文。

定向Vitest最终2文件通过，6项通过/1项真实GitHub集成跳过（3.00秒）。以虚拟readdir清单验证20,000进入后续大小检查、20,001提前拒绝，真实小目录验证复制、忽略目录、入库和去重；市场使用离线缓存验证相同边界且无下载/临时目录/入库。首轮真实20k夹具产生约40k文件，清理Hook超过10秒并使同轮2项既有测试超时，退出1（139.10秒）；已替换为上述有界测试，未把失败记录或模拟扫描称作真实20k全链路性能验收。Node/Web类型检查、Biome331文件（775ms）、生产构建main113/preload3/renderer2237模块及25份TencentDB源哈希均通过。

联网读取Cline、PenguinHarness、Trae Agent、CommandCode及Anthropic/Microsoft官方资料，并对照当前SessionService、Repository、ChatService、App和文档模块，新增[三模式与办公调研记录](docs/AGENT_MODES_RESEARCH_1.3.3.md)。关键增量为渐进技能、确定性办公生成/编辑与重算/渲染验收、连续失败换策略、可恢复工具原文与更细检查点。CommandCode公开仓库未声明许可证，npm为UNLICENSED，不复制实现；本机官方Office技能/运行时不作为产品再分发依赖。

待用户确认Chat附件只读解析、web_search是否包含web_fetch、可选Office COM、运行中Code/Work切换和自定义Profile适用范围。已确定要求继续保留：主界面切换；Code/Work共用目录与会话；Chat独立页面/分组、不选目录、不使用自定义Agent；三模式共用供应商和压缩配置。Chat未来须在工具发现和执行双层强制白名单，并跳过MCP/Skills/Hook等；仅workspacePath=null不构成限制。

双语使用手册和更新日志只写入实际导入修复；`node scripts/check-package.cjs --source`通过33项资源、生产依赖和1.3.3版本预检，`git diff --check`无空白错误。版本1.3.3、schema8、协议修订号和已有数据目录保持。没有UI修改、模式迁移、正式打包、发布、云SQL、用户正常DB/Key访问或提交/推送。详细结果见[1.3.3验证记录](docs/VALIDATION_1.3.3.md)。

## 54. 2026-11-17 / 1.3.3 三模式与 Code/Work 专精实装

用户逐项确认第53节五个问题并授权“开始实装/继续”。本轮实现主界面 CodeAgent、WorkAgent、ChatAgent 切换，版本保持1.3.3，协议修订号保持`2026-11-04.3`，原子图标及数据目录不变。schema9在原schema1-8后顺序追加`agent_mode`、`chat_group_id`及聊天分组表，旧会话默认Code，迁移不复制/清空历史。新增ExcelJS4.4.0（MIT）作为原生XLSX结构化作者库，lockfile、第三方说明及资源预检同步；不复制本机Office技能、脚本、运行时或未获许可的CommandCode实现。

### 模式、数据与权限

- Code/Work使用同一会话、工作目录、历史、草稿与附件；任务及子任务运行时前后端均拒绝切换，完成或手动停止后生效于下一轮。自定义Profile新增`applicableModes`，旧配置默认两者通用，限制适用范围同时用于直接会话、切换和子Agent选择。
- Chat有独立页面、选中状态和目录，支持搜索、分组新建/改名/移动/删除、会话重命名、置顶、归档/恢复及删除，不选择工作文件夹，不显示本地文件/任务工作台或自定义Profile。删除分组仅移动到未分组，保留会话内容；窄屏选中对话后收起抽屉。
- Chat的`availableTools`、ChatService执行入口和ToolRegistry均强制只允许`web_search`及`web_fetch`；跳过项目指令、记忆、Skills、MCP发现/启动、Hook、自定义工具、命令、浏览器操作及子Agent。不是仅靠提示词或`workspacePath=null`限制。
- Chat可主动上传PNG/JPEG/WebP/GIF/BMP/TIFF/AVIF位图、PDF、DOC/DOCX、XLS/XLSX及PPTX，只解析上传字节；真实编码大小和25MiB限制在主进程核验，图片还核对MIME与文件头签名，SVG、伪装内容和旧二进制PPT明确拒绝。草稿保存和发送阶段都去掉调用者提供的本地路径与伪造提取内容。供应商、模型、压缩、重试和基础设置共用。
- 审查修复Profile权限优先级：具体工具/subject规则优先于组回退，不再因对象字段顺序覆盖显式deny；`use_skill`和输出恢复先带subject检查deny/allowlist，再请求ask审批。

### 实际专精机制

`agents/domain-skills.ts`及`resources/prompts/skills/`提供12个原创工作流（代码5、办公6、共享质量1），覆盖工程/调试/验证/前端/平台以及Word/Excel/PPT/分析/研究/运营。目录仅注入元数据，`use_skill`按需读取正文和选中扩展资源，单页32,000字符；资源相对路径、文本类型和2MB限制保留，加载不等于执行脚本或授权。

`failure-loop-guard.ts`按工具名和规范化JSON参数累计失败，相同调用失败3次后阻止重放并要求换策略，12次连续失败/拦截终止本轮；成功重置连续失败计数。`BoundedOutput`、`ToolOutputStore`保留大工具结果并提供`read_tool_output`会话隔离分页；单结果最多4,000,000 UTF-16字符的头尾及明确中间缺口，单会话最多40条/16,000,000字符，删除会话同步清理。UTF-16分页与截取边界有代理对回归，不宣称超出捕获上限的中间原文可恢复。

`SnapshotService.createFileCheckpoint`为主会话full-access host的文件工具写入增加局部写前点。restore只处理manifest范围、先做同范围safety，不清理范围外文件；单文件25MiB、单点及单轮累计128MiB、每轮最多128点，达到预算后可见提示并保留运行开始快照。命令、MCP及外部副作用不是逐文件快照保证。既有AST/LSP、测试/Lint/类型检查与最多三轮验证闭环继续使用。

### Office工具与真实边界

`documents/office-document*`和`office_document`提供XLSX结构化创建/编辑（类型、公式、区域/追加行、样式、列宽、合并、冻结、筛选、表格及工作表操作），以及PPTX旧稿形状文字/表格单元格/备注的源SHA绑定编辑。未修改ZIP部件保留原始字节；宏、签名、外链、OLE及无法保真的复杂部件拒绝，不能称任意Office文件无损。PPT生成增加商务主题、封面、页脚页码、表格/图表风格；已有DOCX局部编辑与排版继续保留。

资产读取、输出预检、源SHA、覆盖、审批、隔离网关、文件锁、外部变更和取消一起生效；每个文件原子提交，PDF和重算工作簿不是跨文件事务。Work完成前最多三轮、每轮六份已改Office文件进入结构/可用重算/渲染检查；图像模型在允许的host路径可读取导出PDF页面后再复核，不把导出成功当目视通过。

可选COM仅Work主会话的full-access host启用，使用临时副本、不自动安装Office、不在隔离失败时宿主回退，已有同类Office实例时降级。宏自动化禁用；在Open前由HWND取得确切PID，核对名称/可执行路径/创建时间及Automation命令行，要求为本次新实例；再证明Documents/Workbooks/Presentations为空，才登记可清理pidfile。非空或无法证明为空时不Close/Quit或清理；正常/超时/取消均按已登记身份清理，不按名称批量结束。取消原原因向上传递。

COM专属预检对DOCX/XLSX/PPTX的非hyperlink外部关系、Word跨run自动字段及XLSX数据连接降级，保留结构结果，不修改普通inspect/edit的支持范围。Word使用16参数`OpenNoRepairDialog`，明确隐藏/只读/不修复/不显示编码对话框，不更改Office全局设置或Protected View。失败和超时返回最后阶段，隔离路径脱敏。不能声称所有Word外链/字段更新或所有XLSX复杂部件已经由普通编辑入口完整阻止。

本轮真实Excel重算由999→5、正常退出/5秒超时清理、已有实例降级且不关闭、取消后确切PID清理均通过；Excel与PowerPoint曾导出有效PDF，但当时未逐页检查。Word本轮打开阻塞，未验收通过；第52节Word历史验收不替代本轮COM接口。最新源码与桌面验证结果、首次失败和剩余边界继续记录在[1.3.3验证记录](docs/VALIDATION_1.3.3.md)，后续维护必须读取追加部分。

本轮不生成正式NSIS/ZIP、不安装/升级、不读正常用户DB/Key、不访问付费模型或云端发布、不提交/推送。实验入口仍为先`pnpm build`，正常退出旧实验实例后执行`.\run-experimental.cmd`。

### 收尾结果与后续维护

完整串行Vitest已退出0：133文件通过/3文件跳过，1718项通过/12项跳过（267.54秒）。该轮早于最后的发送准备锁和COM预检/诊断补充；最后修改另以Renderer3文件18项、Office及文档/决策运行时3文件74项通过/3项手动COM跳过覆盖，不与全量数字相加。首次全量失败、Windows junction夹具修复、独立重跑及剩余并行环境边界保留在验证记录。外层deadline另以零延迟期限定向1项通过，不再依赖Excel启动慢来制造超时，也不将此用例称为已证明Office实例清理。

前端追加按会话的准备锁/启动锁：草稿落盘和FileReader前锁定，编辑重发在IPC前锁定，失败解锁、成功保持至运行结束，不互相误释放。修复800px Chat输入框被挤进0px网格列及窄屏偏好污染桌面侧栏；桌面侧栏与窄屏抽屉状态分离。最新TypeScript、Biome348文件（328ms）、生产构建121/3/2242模块、48资源/生产依赖/1.3.3预检均通过；未生成安装包。收尾差异空白检查通过，10份相关Markdown可解析、127个本地文件目标存在。

最终真实Electron专项`.impeccable/review/v133-agent-modes-1794915550504/`退出0：11/11组、21次本地模拟请求、11界面截图、无renderer异常，覆盖模式共用/独立目录、延迟附件和重发准备锁、后端运行锁、文件检查点/大输出恢复、Chat上传与恶意工具拒绝、分组表单/目录管理及正常重启持久化。实际查看1440px Chat日夜/Code夜间、800px Chat日夜/抽屉和分组截图，输入框完整、无阻断性遮挡或水平溢出。Work Excel真实重算42*2=84、PDF导出、1页图片回传模型input_image通过，该页已实际查看；最小夹具不代表复杂报表美观或公式矩阵已验收。

最新Word手动诊断因已有Word返回unavailable/OFFICE_IN_USE（最后阶段“检查Office进程”），源字节不变，未接管或关闭。测试要求verified因此退出1，不能把占用降级称为Word渲染已通过，也不能证明此前Open阻塞已解决。先前无owner的PowerPoint未批量结束；不宣称系统所有Office进程都已清空。PowerPoint本轮仍缺逐页目视验收，Word本轮未验收通过。具体命令、失败记录与证据以[1.3.3验证记录](docs/VALIDATION_1.3.3.md)末节为准。

## 55. 2026-11-17 至 18 / 1.3.3 专业技能、自动发现与可配置快捷窗口

用户要求继续增强 Code/Work 的专业能力，参考 ZCode、WorkBuddy 与 Codex 的公开机制，自动探测已安装 Skills/插件，并增加 Chat 快捷窗口和主界面/托盘全局快捷键；最新指令将快捷键改为设置内自行录制并检测占用。版本保持1.3.3、schema9、协议修订号`2026-11-04.3`，数据目录、原子图标和现有框架保留。

### 专业工作流和 Office 设计

五个 Code 技能及五份条件加载参考强化任务契约、仓库侦察、大型改动、故障取证、测试设计、前端验收与发布安全，沿用现有计划、代码索引、LSP、受管命令、失败保护、输出恢复、检查点和验证闭环。Work 技能及四份 Office 参考强化受众、语气、论证、内容取舍、叙事、表格表达和逐页检查；资料来源和不可复制边界见[Code调研](docs/CODE_AGENT_RESEARCH_1.3.3.md)、[办公调研](docs/OFFICE_AGENT_RESEARCH_1.3.3.md)。这些是原创工作流和确定性工具增强，不是复制竞品私有技能，也不是同模型质量A/B或能力追平证明。

`office-visuals.ts`及文档schema提供`executive/consulting/editorial/minimal`设计预设和`airy/balanced/compact`密度。DOCX/PDF增强封面、正文层级、表格和callout；PPTX以`slide.kind`控制封面、章节、statement、cards、timeline、数据和收束，增加原生`metric_grid`及`callout`，默认内容带居中，显式坐标保留。Excel增加报告表面、标题/表头、条纹、网格线、打印区域、重复标题行、方向和按页适配，旧工作表可用`format_sheet`单独应用。

### 全部启用能力的按需发现

`ExtensionService`为所有已安装且启用的Skill/插件建立元数据索引；会话手动选择的扩展优先展开，其他能力可由`discover_capabilities`按上下文查询和分页发现，再以精确ID交给`use_skill`读取正文或相对路径文本参考。禁用扩展不进入结果；插件关联MCP同时受启用状态、Profile、审批和隔离约束，直接调用也不能绕过停用状态。参考加载限制相对路径、真实路径边界、链接、文本编码、单资源大小与页预算；不自动执行扩展脚本。Chat依旧不索引、不加载Skill/插件/MCP。

### 快捷窗口、快捷键和草稿

`quick-chat-controller.ts`管理独立Chat会话的10分钟滑动租约，首次及过期后的下一次唤起新建，会话未过期的再次唤起续期；读取状态、发送和等待不续期。旧历史、已保存草稿和后台任务保留。快捷窗口复用`ChatView`，不选择工作目录，沿用Chat上传只读问答及`web_search/web_fetch`限制；IPC和runtime事件仅限当前快捷会话，不能调用本地文件、命令、MCP、Skills、Hook、子Agent或修改全局设置。缺模型、加载失败、停止、新建、打开主界面、关闭隐藏及正常重启有实际路径。

设置 → 外观与语言 → 全局快捷键可逐项录制，录入完成即尝试保存，支持Ctrl、Shift、Alt至少一个加一个受支持主键；默认`Ctrl+M`打开Chat小窗，`Ctrl+Alt+L`显示/聚焦主界面或收回托盘。重复、Windows保留组合和不支持的键有明确校验；Numpad不冒充主键区数字，非QWERTY字母优先按实际`event.key`。录制期间临时释放本应用绑定，Esc、失焦、切页、卸载和迟到请求均恢复；系统实际注册检测占用，失败或持久化异常回退原绑定，状态反映实际结果，不抢占其他应用。配置存入`app_settings`的`desktop.shortcuts`，没有新增schema。

主窗口与快捷窗口的草稿变更只同步相应会话。保存携带`baseRevision`，在现有SQLite savepoint内比较，冲突不改文字或附件，保留当前窗口内容并停止自动覆盖；用户明确选择“用本地内容覆盖”或“载入最新草稿”。旧无`baseRevision`调用保留兼容。正常退出/重载等待全部窗口和会话flush结束，任一失败取消操作；`Promise.allSettled`避免先失败的草稿让仍在保存的窗口提前解锁。新建前快捷窗口必须保存成功，主窗口flush有2秒等候上限并记录失败，避免卡住主窗口阻止拉起；这不放弃主窗口草稿。

### 验证边界

最终结果继续追加在[1.3.3验证记录](docs/VALIDATION_1.3.3.md)。Office样例目录为`.impeccable/review/v133-office-craft-1794920209360/`：Excel重算及1页PDF、PPTX七页PDF已实际逐页查看，源文件字节不变；Word因已有用户实例返回`OFFICE_IN_USE`，本轮未渲染通过，不关闭用户Office来取得测试结果。样例不是复杂财务模型、任意旧稿或竞品质量矩阵证明。

最终完整串行Vitest139文件通过/3跳过、1791项通过/14跳过（155.97秒），包含空草稿CAS回归。随后仅补齐快捷Chat英文词条，重新类型检查、Biome362文件（328ms）、生产构建126/3/2248模块、25份TencentDB源哈希及57资源预检通过。最终Electron专项`.impeccable/review/v133-quick-chat-1794962800041/`退出0：22组通过/1组环境跳过、21截图、3次本地模拟请求、0 renderer异常；实际注册占用、CDP录制、回退、重置与重启恢复均通过。独立系统探针同样未接到注入按键，因此本轮原生按键唤起未验证，未用直接动作或CDP录制冒充；早期20/20组曾完成原生唤起，历史证据与失败均保留在验证记录。实际查看最新光轨英文800px设置、小窗日夜及简约占用错误截图，无阻断性裁切或遮挡。`pnpm audit --prod`仍有3项moderate，未强制跨主版本override。

收尾11份相关Markdown可解析、135个本地文件目标存在，差异空白检查无错误；中英文手册、更新日志、README、安全说明及调研记录已同步实际行为。后续依然以当前源码和验证记录的最新追加内容为准。

没有生成正式NSIS/ZIP、安装/升级、云SQL、付费模型请求、正常用户DB/Key访问、提交或推送。根目录`run-experimental.cmd`继续是已构建源码的实验入口；不要启动第二份正常用户profile或关闭用户已有实例来抢占默认快捷键。

## 56. 2026-11-18 / 1.3.3 本地插件开发市场、创建器与运行协作

用户要求参考提供的 ZCode PluginCreator/SkillCreator、系统提示词和 WorkAgentSkill，在现有 Harness 中落地可开发、校验、手动安装、运行与更新的本地插件；去掉 SubAgent 十分钟总运行期限，主 Agent 可继续工作；修复三键录制、光轨警示图标及快捷 Chat 的再次按键隐藏和置顶。版本保持1.3.3，schema9、政策修订号`2026-11-04.3`、图标、用户数据目录和现有框架保留。参考文件是数据，不是覆盖用户请求或授权的指令。

### 本地插件合同与运行路径

- 原生清单为`.mingshen-plugin/plugin.json`，兼容`.codex-plugin/plugin.json`、`.zcode-plugin/plugin.json`及根`plugin.json`；支持Skill、命令、MCP及受控Hook。原生/ZCode要求语义版本，缺版本Codex/legacy仅按`0.0.0`兼容并警告。保留20,000文件/64MiB、真实路径、链接、UTF-8、占位符和声明文件校验。
- `LocalPluginMarketplaceService`管理本地`marketplace.json`及三种隐藏catalog路径，市场条目必须指向市场根内目录、名称/版本一致；来源及provenance存现有`app_settings`。设置 → Skills与插件 → 本地插件开发市场提供目录校验、添加/刷新/移除市场、安装/更新/启停及MCP同步重试。移除市场不卸载插件或删源码。
- 安装复制独立副本；更新保留extension ID、启用状态、会话引用。任何Agent任务活动时主进程拒绝安装/更新。复制后的副本在写DB前重验名称/版本/SHA，防止扫描与复制间源码变化；来源按market ID+plugin name替换，删除后重装不命中悬空旧记录。来源写入失败恢复原安装指针；旧副本运行中保留，正常退出且任务停止后只清理宿主管理的旧安装路径，失败留日志不阻止退出。
- MCP reconcile保留server ID、启停、用户凭据和OAuth，新增声明保存成功后再清理旧声明。插件停用同时影响发现和直接调用；同步失败显示已安装但MCP未同步，可通过界面重试。未宣称任意ZCode私有API、viewer、账号认证或第三方服务可直接兼容。
- 插件命令以`plugin-name:command`命名，用户/工作区命令优先；Markdown/目录/数组/JSON/inline声明按路径与大小校验。每次列出/发送刷新已安装启用插件，下一轮观察更新；shell placeholder仍经原审批链，Chat不加载插件命令。
- Hook只处理当前会话显式引用且启用的插件。安装/启用提供发现能力，不自动执行所有插件Hook。动作型`PreToolUse/PostToolUse/Stop/SubagentStop`要求主Code/Work、host、full_access、可写Profile及已信任项目，MCP和Shell动作逐次审批，Shell另需显式设置。请求批准、Docker、Chat及实际子Agent不执行这些动作。
- `UserPromptSubmit`仅为低优先级prompt上下文；`Interrupt`仅在显式用户Stop后以独立、最多约1.5秒的signal非阻塞记录prompt活动。两者的command/MCP声明给warning且runtime跳过，不弹审批/启动进程/恢复工具。未知Hook事件拒绝。插件文本不能覆盖用户、安全或权限规则。

### 创建器、来源与专业流程

Code/Work默认可发现`builtin:skill-creator`、`builtin:plugin-creator`、`builtin:harness-plugin-api`，按需加载正文；`use_skill`同时返回当前实际SDK绝对路径，不猜用户工作区里的SDK位置。SDK位于`resources/sdk/plugin-dev/`，提供create/validate/marketplace，故意保留的TODO必须实现后才能通过；`authoritative:false`预检不能替代宿主校验。marketplace正常写入最多等待15秒；锁超过60秒时不按mtime自动删除，保持catalog原样并报告锁路径，只能确认无writer后人工删除锁文件。模型`local_plugin`只支持inspect/validate/list_markets，仅有工作区的host+full_access主Code/Work开放，并受Profile读取权限和工作区真实路径约束；没有安装/更新/启用工具。手动步骤与完整合同见[本地插件说明](docs/LOCAL_PLUGINS.md)。

`WorkAgentSkill/`按最新七组版本族92份SKILL加六个独立入口核对，共98份物理正文、93个唯一名称、98个唯一SHA。不是把98个来源原样注册；运行时为19个原创领域工作流，办公能力默认在Work目录可用，正文按需加载。新增PDF、视觉设计、离线HTML可视化、图片来源工作流，强化原有Word/Excel/PPT的结构、叙事、语气、排版和验证参考。设计资源361文件/4,809,702字节，包括74个骨架、8个子技能，82个入口有机器索引并保留许可。Office/PDF来源许可冲突或明确专有的正文/脚本不机械复制，使用原创适配，宿主私有JWT/Viewer/Canvas接口不随技能启用。完整出处见`work-visual-design/references/source-provenance.md`。

`core/coding/work/runtime/tools.md`吸收参考中的任务契约、证据、独立工作并行、失败换策略和交付质量原则，没有将参考中的私有运行时或高优先级措辞作为授权。

### SubAgent与快捷窗口

SubAgent不再组合十分钟`AbortSignal.timeout`，继承父任务取消signal；spawn立即返回，父会话可继续独立工具，显式wait或完成前自动补收结果。子任务明确完成/失败、用户停止、父取消或退出仍终止，单次工具/网络/模型请求超时和失败保护保留。完成Promise的十分钟清理是完成后查询记录保留时间，不是运行期限。

小窗显示/隐藏/快捷键toggle/托盘入口统一顺序队列，隐藏不续租；延迟页面载入不会把已隐藏小窗重新弹出，连续show/hide/show和失败重试保留最后一次操作。Pin按钮同步真实BrowserWindow AlwaysOnTop，偏好跨重启保存。录制器允许Windows普通Ctrl+Alt的AltGraph标记，支持三键和四键；默认Ctrl+M、Ctrl+Alt+L保留。光轨警示图标使用固定居中容器。最终窄窗视觉收口和验证结果以本轮验证记录末节为准。

### 本轮验证基线与边界

首轮冻结运行时代码后完整串行Vitest（session15699）退出0：141文件通过/3跳过，1843项通过/15跳过，217.88秒；最后MCP Hook信任补查后的完整结果见下文。Node脚本10文件73项通过；SDK八组通过。此前全量3项提问测试在异步Hook前置后过早读取broker，改为等待真实登记事件；另一轮测试与Hook最后改动交错导致2项prompt遍历断言失败，当前13项Hook单测及随后冻结全量均通过。历史失败保留在验证记录，未放大全局超时掩盖。

快捷窗口隔离Electron专项`v133-quick-chat-1794977002241`为30/30组、24截图、3次本地模拟模型请求、0renderer异常，包含真实Windows全局按键、三/四键录制、占用回退、显示竞争、崩溃恢复和置顶重启。插件专项覆盖真实设置UI、Skill、命令、MCP、审批Hook、停用、更新和重启；最后的窄窗截图与检查结果继续追加到[1.3.3验证记录](docs/VALIDATION_1.3.3.md)。

资源预检包含453项资源和生产依赖，递归检查内置技能、82设计入口及封包副本哈希。源码构建不是正式安装包；未生成NSIS/ZIP、安装/升级、云SQL、付费模型、正常用户DB/Key或提交/推送。审计仍有3项moderate传递依赖，Word实机占用降级与复杂Office/第三方插件未验收边界沿用前轮真实记录，不因本轮通过而改成已验证。

### 最终收口

文档复核发现MCP Hook缺少动作前项目信任检查，现已在查询Server、审批和调用前拒绝未信任/无工作区项目，目标14项通过，并独立复核；Shell原有信任检查保留。Interrupt仅声明式通知不要求信任，文档已纠正；SkillCreator不再暗示存在模型安装工具，明确独立Skill由设置导入、插件由用户从开发市场安装。

最后冻结完整串行Vitest（session36167）退出0：**141文件通过/3跳过，1844项通过/15跳过，236.97秒**。随后无运行时代码修改。Node/Web类型检查、Biome370文件（625ms）、453资源/生产依赖/1.3.3预检及生产构建130/3/2250模块通过；25份TencentDB源哈希通过，main1552.66kB、renderer JS2515.16kB、CSS354.87kB。

最终插件市场专项`v133-local-plugins-1794980255768`退出0：9/9组、23次本地Responses请求、2次真实Hook审批、5次预期Chat工具拒绝、7截图、0renderer异常；真实安装/更新/停用、重启引用、stdio MCP、命令、Hook及旧副本退出清理通过。增强断言同时检查设置滚动容器和插件区内部宽度，Simple800为590/590与550/550，Orbit英文800为565/565与525/525；最终截图已查看，无横向溢出。≤1280px隐藏顶部装饰标识，避免模式按钮重叠，产品品牌保留。

三模式专项`v133-agent-modes-1794978939868`退出0：11/11组、21次本地Responses请求、11界面截图、0renderer异常；模式切换/准备锁、局部检查点、大输出恢复、Chat上传及恶意工具拒绝和重启持久化通过。真实Excel隔离副本重算42*2=84、PDF页面回传模型及input_image通过，唯一页面已目视检查；仍为最小计算夹具，不代替复杂报表或Word验收。此轮与上文快捷窗口30组早于最后MCP信任补查，不伪称补查后重跑，相关行为未修改。

收尾20份相关Markdown可解析、150个本地文件目标存在，`git -c core.safecrlf=false diff --check`通过。全部命令、失败历史、截图证据和剩余边界见[1.3.3验证记录](docs/VALIDATION_1.3.3.md)最新追加部分；根目录`run-experimental.cmd`可运行当前已构建实验版，不启动第二份正常用户profile或关闭既有实例来抢占快捷键。

## 57. 2026-11-18 / 1.3.3 插件开发故障与 Work 全版本技能清单

用户截图显示内置创建器可加载但`discover_capabilities`三次返回空、受保护会话未提供`local_plugin`、系统Node不在PATH且安装目录SDK被沙箱拒绝。用户同时要求核查`WorkAgentSkill/`每个技能，包括同名PDF的不同版本。版本仍为1.3.3，schema9及政策修订号`2026-11-04.3`不变，不生成正式安装包、不操作正常用户profile或付费模型。

### 统一发现和宿主校验

`domain-skills.ts`提供内置能力元数据，`chat-service.ts`将其与`ExtensionService`扫描的已安装启用扩展统一合并，再过滤、排序和分页。会话手选扩展仍优先，停用项仍排除。Code默认9个基础入口，Work默认14个基础入口加124个来源入口；这些数量不包括用户另外安装的启用扩展。Chat没有该发现和加载能力。

只读`local_plugin`支持主Code/Work、host、有工作区的请求批准及完全访问会话。`inspect/validate`先约束绝对路径及工作区范围、保护Git和Windows路径、拒绝链接，再按canonical路径复查Profile读取权限；请求批准需要路径读取审批，Profile ask在完全访问模式也需要审批。等待批准后重新检查safe path、lstat和realpath，根目录变化则不扫描、不记忆本次会话授权。扫描/读取/哈希透传取消signal，取消原因不转为普通插件校验错误。Docker、worktree、Chat及实际子Agent仍不开放该工具。

宿主校验直接调用主进程服务，无系统Node、PATH或SDK子进程前提。Creator及SDK返回说明已同步；SDK仅为用户可选CLI预检，不授予沙箱外访问。安装、更新和启停仍由用户在设置的本地插件开发市场手动完成。生成任务完成后提供实际市场路径和界面步骤并结束当前轮次，不一边占用活动任务一边等待安装。

### 全树来源及适配边界

此前98份只覆盖最新七个版本系列的92份及六个独立入口，遗漏26个历史版本文件。全树重新按每个物理`SKILL.md`核对，共124路径、104不同源正文SHA、93名称。每个路径都有独立稳定ID、原始路径、版本、SHA、许可处理和打包资源映射；相同正文的历史版本可共享资源，入口不消失。完整[机器目录](apps/desktop/resources/prompts/skills/work-sources/catalog.json)及[逐项清单](apps/desktop/resources/prompts/skills/work-sources/inventory.md)随包保留，运行时不依赖仓库外层`WorkAgentSkill/`。

82个设计骨架/子技能的原始参考资源保留来源字节及许可，来源入口通过明确的Mingshen资源路由读取跨目录参考，不扩宽单技能资源边界。其余22个不同源正文（含主设计入口）使用原创工作流适配，区分可用、条件可用和无对应宿主操作的能力；不机械复制许可冲突的Office/PDF正文和私有宿主脚本。PDF共10个物理来源、5个不同源正文：制作、阅读、查看讨论、通用处理四类流程，另外保留Viewer 0.2.1的历史正文差异。

全部来源入口默认对Work可发现，以精确ID按需加载，无需用户逐项启用，也不把124份正文塞进每次提示词。Code不加载Work来源，Chat仍禁用Skills。来源清单完整和文本可加载不等于所有上游工具已实现；私有JWT/认证、Viewer/Canvas宿主API、任意PDF编辑或未经验证的脚本不会因内置而自动可用。具体操作路由和不可用项在适配正文中说明。

### 本轮验证

新增覆盖统一发现、同名多版本、全部来源加载、资源隔离、canonical Profile deny/ask、审批期间目录链接替换及扫描中途取消的回归；真实Electron专项使用独立profile和本地合成供应商验证创建器、请求批准校验、来源分页与手动插件生命周期。命令、最终结果和失败历史在[1.3.3验证记录](docs/VALIDATION_1.3.3.md)本轮追加部分记录，以实际完成结果为准，不复用第56节全量数字证明本轮改动。

冻结后的完整串行Vitest退出0：**141文件通过/3跳过，1855项通过/14跳过（179.88秒）**；Node脚本11文件89/89，SDK八组，Node/Web类型检查和Biome370文件通过。资源预检763项、生产依赖及1.3.3通过；生产构建main130/preload3/renderer2250模块及25份TencentDB源哈希通过。catalog SHA稳定为`c5937d1fce55b1cbde2d272016fa961175b918e489d2f3e34ff92ce94257e9e7`；独立全树集合核对未映射源、缺失入口、资源根及SHA差异均为0。

最终Electron插件专项`v133-local-plugins-1794992595490`退出0：**16/16组、89次本地Responses请求、4次实际审批、6次Chat预期拒绝、9截图、0renderer异常**。清空PATH后受保护Work仍可加载内置Skill并审批校验；Work分页发现124来源并真实加载五种PDF正文，Code/Chat隔离；真实设置安装、停用、更新、重启引用及旧副本清理通过。实际查看最终光轨日夜/800英文市场及读取审批截图，无横向溢出。此前桌面会话选择竞态、审批字段断言和未等待动画的截图问题均为夹具问题，修正并重跑，细节在验证记录；没有修改模式或审批安全边界以通过测试。

最终构建之后仅更新smoke夹具及文档，没有再改运行时代码。收尾23份Markdown可解析、282个本地链接目标存在，smoke语法及差异空白检查通过。源码实验入口仍为`run-experimental.cmd`，旧实验实例应正常退出后再启动；不关闭用户实例抢占快捷键。没有正式安装包或发布，前轮依赖与Office未验收边界继续保留。

## 58. 2026-11-18 / 1.3.3 手动内置引用、Work新增技能与下一轮队列

用户要求内置可调用Skill和Plugin同时支持自动发现及手动引用；新增PPTMaster、ASD-STE100仅供Work使用，Code原技能保留；调研并实装T3 Code中适合当前Harness的能力。版本保持1.3.3，schema9、政策修订号`2026-11-04.3`、图标、用户数据路径和现有框架不变。

### 内置与已安装能力的引用

输入框“+ 引用”提供内置Skills、内置Plugins、已安装Skills、已安装Plugins四组，支持搜索、多选、取消和可移除chip。同名Work来源显示原始路径、版本和SHA指纹，可选择具体PDF版本。自动发现保持可用，手选表示本轮任务偏好，不授予额外权限。

`SessionBuiltinCapabilityService`独立保存`session.builtinCapabilities.v1.<sessionId>`，内置Skill与Plugin合计最多32项，不写入有外键约束的`session_extensions`。Code/Work切换时保留选择，Work-only项在Code隐藏且不进入提示词，切回恢复；fork、子会话和工作区新会话按现有继承路径复制，删除会话清理。Chat拒绝list/set。目标会话或任意后代运行、等待审批或准备发送时禁止变更；异步读取catalog后重新检查模式和忙碌状态。模式切换另由`main/index.ts`的递归`chatService.isSessionBusy`守卫覆盖准备阶段，不能只查看`SessionService`的数据库status判断是否存在IPC缺口。

手选Skill的精确ID进入任务提示。Profile允许`use_skill`且无需交互审批时，按总64,000字符预算预载实际只读正文，包括默认读取策略；ask、deny、不可用或超预算项仅保留精确ID，实际使用仍走`use_skill`、审批和资源边界。正文从属于用户指令、应用规则及权限，已预载正文无需再次读取。

`builtin-plugins.ts`登记真实工具组`builtin:plugin-github`与`builtin:plugin-browser`，Code/Work均可自动发现和手选，按实际注册工具及Profile可用工具取交集。Plugin提示是工具偏好，禁止将Plugin ID交给`use_skill`；选中不会登录、连接账号、打开浏览器或放宽审批。Token Saver仍为自动中间件，不伪装为可调用插件。

### Work专属PPTMaster和ASD-STE100

- `builtin:work-ppt-master`：上游6.9.0，MIT，Copyright 2025-2026 Hugo He。包内`work-ppt-master/references/source/`保留13,089文件、39,892,466字节，树SHA-256为`6e8023b4b8ab81e0fb4cffb71c1dcea8dd4f6f6abca490395c21fb273bfe473c`；排除`.env.example`，LICENSE、12,027个SVG图标和186个CC0 WAV的NOTICE随包。
- `builtin:work-asd-ste100`：上游0.4.0，MIT，Copyright 2026 Dustin Yuchen Teng。包内9文件、231,661字节，树SHA-256为`0886b021b0f18d8997736af0a3b51a3492dd2c3b378ebb7484bead7803e04930`；保留规则、示例与标准库linter，不包含官方完整词典，不声称官方认证或由linter证明语义保真。

两者仅属于Work，Code基础9个Skill保持原有范围；领域总表为21项（19个原有原创工作流加2个开源适配），Work基础16项加旧来源124项。旧Work catalog、ID和SHA未重写，PDF仍10物理入口/5不同源正文。新增资源的完整文件集合、字节、SHA、许可及无链接情况已独立对账。

Wrapper把上游流程路由到真实`create_document`和`office_document inspect/edit_presentation/verify`；`read_document`的PPTX能力仅是幻灯片文字提取。上游脚本和Python依赖不会自动运行或安装。`use_skill`只读取不超过2MiB的UTF-8文本资源并分页，SVG可读取，WAV不能通过该接口返回或播放；需要执行或复制资源时仍按当前任务授权、工作区、审批和隔离规则处理。完整打包和可加载不能替代真实Office或上游脚本全流水线验收。

### T3 Code调研与实际落地

参照[pingdotgg/t3code](https://github.com/pingdotgg/t3code)固定commit`3babab1497ddd82dfd90a0d53ad4d16ebae41063`的Composer、生命周期和contracts，借鉴队列交互并用当前架构实现，没有复制远端控制面或供应商runtime。来源、MIT说明、代码位置及未实装候选见[T3调研记录](docs/T3_CODE_RESEARCH_1.3.3.md)。

`QueuedPromptService`与`QueuedPromptTray`允许主界面Code/Work/Chat在任务忙碌时加入下一轮，当前run继续；支持文字编辑、附件整体替换、删除和上下排序。完成、失败、停止或审批结束均不自动发送，必须点继续。最多8项、附件总量50MiB、单文件仍25MiB；存储只保留验证后的附件字节，不保留本地路径，列表仅返回元数据，继续时交由现有`ChatService`重新校验及处理。QuickChat六组IPC拒绝，实际SubAgent的add/continue由服务层拒绝；Chat的工具边界保持不变。

配置快照包含mode、workspace、profile、provider、model、permission、approval和execution，变化时阻断继续。发送前持久化`sending`claim并锁定同会话继续操作，接受后记录runId再出队；清理失败返回可见warning且不能重复派发，重启后仍保留防重放状态，可明确删除。fork不复制队列，删除会话清理。该队列不修改已执行轮次，也不实现Steer、provider-native continuation、远端控制面或自动Resume。

### 验证与交付

本轮最终自动检查、真实Electron引用/队列交互、视觉证据及失败修正继续记录在[1.3.3验证记录](docs/VALIDATION_1.3.3.md)最新追加部分，不复用第57节数字作为本轮证明。README、双语手册/更新日志、第三方通知、调研和DESIGN已同步实际合同。

最终完整串行Vitest为144文件通过/3跳过、1880项通过/14跳过（188.09秒）；之后仅修正引用空状态三个英文分组插值，重新Node/Web类型检查、Biome380文件及生产构建通过。Node脚本11文件89/89、SDK八组、13,865资源/生产依赖/1.3.3预检通过。最终文案构建的Electron引用专项`v133-local-plugins-1795007753673`为26/26组、104次本地Responses请求、4次实际审批、15截图；队列专项`v133-queued-prompts-1795008343768`为10/10组、10次本地Responses请求、7截图，两者均0 renderer异常。实际查看光轨日夜及800英文引用/队列截图，队列前景命中、纵向完整可见且无横向溢出；主Chat队列、实际SubAgent拒绝及QuickChat六组IPC拒绝均有真实运行证据。完整数字、最终构建先后关系及Office边界以验证记录为准。

没有生成正式NSIS/ZIP、安装/升级、云SQL、付费模型调用、正常用户DB/Key操作、提交或推送。实验入口仍为`run-experimental.cmd`；前轮依赖审计、Word占用降级和复杂Office/第三方服务未验收边界保留。

## 59. 2026-11-18 / 1.3.3 frontend-design 安装与光轨布局收口

用户指定安装`WorkAgentSkill/frontend-design`并据此优化光轨布局。已安装到`C:\Users\ASUS\.codex\skills\frontend-design`，两份文件共19,564字节，文件集合及SHA-256与源一致，Apache 2.0许可保留；没有覆盖已有技能。此为当前开发环境的Codex技能安装，不改变CodeAgent/WorkAgent内置技能范围。已直接完整阅读并在本轮应用；后续新会话可自动识别。应用继续保持1.3.3，schema9、政策修订号`2026-11-04.3`、正式水青原子图标及用户数据位置不变。

设计采用连续工作平面：56px无外框标题条、48px工具轨、12px侧边距、8px间隙、44px面包屑与24px状态栏。会话、审查和任务沿同一网格对齐；右下任务默认`clamp(224px, 28dvh, 304px)`，窄窗或短高文件编辑时收至160px。`App.tsx`集中声明480px最小聊天宽度与88/96px侧栏/Inspector外壳预算；保留原抽屉互斥、布局持久化和节点挂载机制。移除重复轨道品牌、假M身份与中央装饰光轨字标，主bitmap品牌和实际操作保留。

日间为白色阅读面及低饱和灰绿外壳，夜间为低饱和墨青，原Orbit品牌、发送和语义色保持。输入框为唯一轻微抬升工具面，上下文分为模型、Agent和工作目录三列，聊天pane宽度不超过600px时重排，权限/引用/指标与推理/发送分层；长模型和供应商仍分别缩略并保留完整title及辅助技术名称。工作台元数据12px，正文14/15px，ChatAgent光轨独立侧栏264px、会话标题13px、时间12px、空态标题固定24px。更新入口保留自适应宽度。主要修改集中`App.tsx`、`orbit-workbench.css`及`agent-modes.css`，没有新增依赖或替换UI框架。

流式入场仅保留3px位移，移除首帧0.55透明度；正文从第一帧保持完全不透明。运行节点和状态信号只在真实运行时呼吸，聚焦、展开与设置使用短反馈；应用关闭动效、系统减少动态效果及隐藏窗口继续生效。DESIGN、双语使用手册/更新日志已按最终有效token、几何和实际模式同步。

最终构建后串行真实Electron：光轨工作台`v133-orbit-layout-1795013890831` **17/17组、13次本地请求（含2次worker）、45截图、0 renderer异常**，涵盖手选引用、实际忙碌队列、文件/任务并排、草稿节点、日夜/双语、800到2559窗口、720x450 CSS缩放等效、Work/独立Chat及真实QuickChat 400x560。风格专项`v133-interface-style-1795013451429` **20/20组、2次本地请求、40截图、两次实际启动、0异常**，涵盖首帧、重载/退出恢复、未保存编辑保护、隐藏暂停和减少动效。长历史最终专项 **11/11组、48测量、13截图、0布局问题/异常/崩溃**，空闲/流式输入P95 11.1/12.4ms，均0长任务。早期15组通过和22:17长历史属于收口前构建，不代替上述最终证据。

Node/Web类型检查、Biome380文件、生产构建main135/preload3/renderer2254及25份TencentDB固定源哈希通过，最终renderer JS2553.66kB/CSS360.93kB；13,865资源/生产依赖/1.3.3预检通过。设计检测器在两份主布局文件无建议，`agent-modes.css`有12项既有共享样式建议；Taste静态检查同时指出共享Chat的旧渐变，光轨已以更高优先级纯色覆盖，不为消除不适用告警改变Simple。实际Electron截图和尺寸为验收依据，未把普通浏览器无preload页面当成桌面应用。完整命令、修正历史与对比证据见[验证记录](docs/VALIDATION_1.3.3.md)本轮末节。

既有renderer helper定向3文件10项通过，8份相关Markdown可解析、110个本地文件链接目标存在，差异空白检查通过；三份smoke临时进程已退出。本轮未重跑完整后端Vitest，前轮1880项是历史功能基线；没有正式NSIS/ZIP、安装升级、线上写入、付费模型、正常用户profile/DB/Key、提交或推送。使用`run-experimental.cmd`运行当前构建，已有实验实例应正常退出后再启动。未认证完整Windows系统DPI/辅助技术矩阵或复杂Office/第三方插件兼容性。

## 60. 2026-11-19 / 1.3.3 光轨任务区与办公起始布局

用户再次指定`frontend-design`继续升级光轨布局。本轮沿用第59节的连续工作平面、配色、中文字体、原子图标及现有框架，重点为可调节的任务区、文件身份、Work空态与编辑保护；版本仍为1.3.3，schema9和政策修订号`2026-11-04.3`不变。

`App.tsx`与`orbit-workbench.css`将右栏组织为文件/审查/终端、8px横向分隔条、任务区。任务区可拖动、单行收起或由Agent入口展开；折叠保留实际组件、计划表单和草稿节点。`PanelResizeHandle`扩展bottom方向，支持上/下方向键每次16px、Home/End最小/最大、Enter或双击恢复默认；Esc、pointer cancel和lost capture撤销拖动，不保存中间值。高度保存为工作区及风格隔离的可选`taskPanelHeight`，有限值限制160–640px并按窗口可用高度钳制；`taskPanelCollapsed`只接受布尔值。重置删除自定义高度，使其重新跟随窗口默认值，而非写入当时像素值；未新增schema。悬停仅高亮32px握柄，完整8px命中区和键盘焦点保留。

审查文件行分成文件名和父目录，预览头优先显示文件名，长目录从末端保留可见内容；完整路径仍在tooltip及辅助技术名称中。行的无障碍名称同时保留新增/删除数。会话行52px、标题13px，右栏辅助按钮和任务操作32px；空态与输入区对齐。光轨Work空会话有Word、Excel、PPT三个起始任务，真实点击只追加草稿并聚焦，不发送模型请求或创建文件；Code、Chat、小窗及简约的既有模式入口保留。

未保存计划时，切换其他会话、Chat、新建或归档当前会话及祖先前先阻止导航，展开任务并返回计划页提示保存或取消；同会话Code/Work切换不卸载编辑器。保护不自动保存、不放弃，也不承诺未保存计划跨重启恢复。通知回复恢复只在选择成功后标记完成，计划结束编辑后重新读取待恢复状态；不能因导航被阻止而提前吞掉恢复标记。保存时仍使用原revision合同。

最终Node/Web类型检查、Biome380文件、定向Vitest5文件37项及13,865资源/生产依赖/版本预检通过。最终生产构建为main135/preload3/renderer2254模块、25份TencentDB源哈希一致，renderer JS2568.04kB/CSS364.11kB。最终光轨专项`v133-orbit-layout-1795051139732`退出0：25/25组、13次本地请求（含2次worker）、52截图、0renderer异常，覆盖真实拖拽、取消、重置、持久化、计划导航/归档保护、双语办公起始入口和三模式/小窗。风格20/20组及长历史11/11组在最后一条握柄hover样式收口前完成，后者48次测量、13截图、0问题，空闲/流式输入P95为7.3/9.9ms且0长任务；不将其误写为最后hover修改后重跑。最终工作台在该修改后完整重跑并实际查看截图。

早期桌面失败属于旧编辑器节点引用和CDP拖动按钮状态夹具，修复后完整重跑，证据与收口先后详见[1.3.3验证记录](docs/VALIDATION_1.3.3.md)本轮末节。DESIGN与双语手册/日志同步。没有重跑完整后端Vitest、生成正式安装包、正常用户profile/DB/Key操作、付费请求、云写入、提交或推送；实验入口仍为`run-experimental.cmd`。

收尾8份相关Markdown可解析、151个本地文件目标存在，差异空白检查通过；只读进程检查未发现三份smoke或其临时profile进程残留。

## 61. 2026-11-19 / 1.3.3 文档同步与打包资源复核

用户要求同步文档、检查资源并提供命令，由维护者自行打包。本轮只更新README、双语使用手册/更新日志、本交接及[1.3.3验证记录](docs/VALIDATION_1.3.3.md)，未修改运行时代码。补齐本轮任务区、Work起始草稿、未保存计划的归档保护和响应式抽屉说明；当前结构表校正为schema9，打包指南移除旧48项/12技能说明和迁移前Documents输出措辞，说明来源目录、可选解包步骤及逐文件缓存回退。

实际在当前Desktop目录使用`D:\NodeJs\node.exe` v24.19.0、pnpm11.25.0运行`.\package-win.cmd --check`，退出0：**13,865项资源、生产依赖及1.3.3版本通过**，未使用pnpm校验绕过或重装依赖。10个打包/运行时/图标/Work来源Node测试文件串行**80/80通过、0失败/跳过（41.60秒）**，包含迁移后hoisted/app-local解析、Windows复制/路径保护、真实ASAR夹具的文档依赖闭包和缺失拒绝。核对builder的10处extraResources源存在，prompts/SDK全树、Office脚本和Markdown文档映射完整，x64/当前用户/未签名NSIS及原子图标配置保持。

正式命令仍为当前仓库根目录`.\package-win.cmd`，自动准备运行时、图标和沙箱、重建应用、预检并执行afterPack，最终生成`apps\desktop\release-artifacts\MingshenHarness-1.3.3-x64.exe`及同名ZIP、ZIP.sha256、ZIP.json。保留`WorkAgentSkill/`、`ppt-master/`和`asd-ste100-skill-master/`用于源码对账；安装应用只依赖随包副本。缓存回退路径及实际发布元数据以本次打包输出为准，不复用旧1.3.2材料。本轮未生产构建、生成解包/NSIS/ZIP、安装升级、执行云SQL、访问正常用户DB/Key、提交或推送，源码预检和测试夹具不代表正式包已验收。

文档收尾8份Markdown可解析、152个本地文件目标存在，差异空白检查通过；文档更新后再次运行用户入口预检退出0，仍为13,865资源、生产依赖及1.3.3版本通过。

## 62. 2026-11-19 / 1.3.3 十条自动FIFO队列

用户要求像Codex一样预编辑后续消息，最多保留10条并按加入先后，在上一任务完成后自动发送下一条。版本继续为1.3.3，schema9、政策修订号`2026-11-04.3`、图标与数据目录不变；第58节8条及手动继续属于历史实现。

`QueuedPromptService`按首次加入顺序派发队首，当前执行不计入10条待发上限。移除上下移动和逐项继续，兼容reorder API拒绝非原位请求，continue API仅允许首项用于异常后的队列级恢复。正常成功完成后自动接续，切换到其他会话或收起窗口不影响主进程派发；审批等待不推进。手动停止、运行失败、自动发送失败及应用重启保留并暂停队列，恢复从首项开始。新一轮正常运行成功也可重新接续；配置变化、归档或未确认派发均阻塞队首，不跳过。

`ChatService`通过明确的`completed/failed/interrupted`结果在执行与资源清理结束后结算，不能用较早发出的`run_completed`直接发送。超短任务结算等待`preparingSends`清理，队列发送确认前已完成的下一轮由发送finally再次调度；runId和发送许可共同防止重复结算、跨轮次越队及并发派发。Stop先暂停队列再abort，dispose先停队列再关其他服务及数据库。队列中的`/compact`按关联runId接续，普通手动压缩不恢复暂停队列。

编辑或选择替换附件先经IPC取得主进程hold，整个队列等待保存/取消后释放，避免把编辑前的正文或附件发送出去。显式取消沿用原已保存内容；切换会话、组件卸载、重载或renderer失联放弃hold时保持暂停，等待用户恢复。hold绑定取得时的会话、token及webContents，旧回调不能释放其他窗口的编辑；新`queued_prompts_updated`事件通知界面重读完整队列，异步列表用版本防止旧结果覆盖。主Chat可用，QuickChat新增两项编辑IPC仍由白名单拒绝，实际SubAgent继续由服务层拒绝。

保留先持久`sending`claim再发送、接受后记runId再出队的防重放协议，清理失败锁定且在自动队列显示原因；重启不自动重放未确认项。仍为存储版本2，可读取原8条队列；附件每项25MiB、总50MiB、配置快照、fork不复制及删除清理合同不变。

本轮实际验证及桌面运行证据见[1.3.3验证记录](docs/VALIDATION_1.3.3.md)本轮追加部分，不复用第58至61节数字作为自动队列证明。README、DESIGN、双语手册/日志及T3研究记录已同步当前合同。

### 最终收口验证

最终完整串行Vitest由捆绑Node在`apps/desktop`执行，退出0：**145文件通过/3跳过，1918项通过/14跳过，227.21秒**。验证记录中的1904项是同一轮收口前历史结果，不是另一套最终数字，也不与1918相加。最终TypeScript类型检查和Biome **381文件**通过；`pnpm build`通过，main **135**、preload **3**、renderer **2254**模块及25份TencentDB固定源哈希一致，产物为main **1620.64kB**、preload **31.47kB**、renderer JS **2580.45kB**、CSS **365.61kB**，入口文件为`index-DcGB_3ap.js`和`index-C2x_YhHG.css`。`.\package-win.cmd --check`退出0：**13,865项资源、生产依赖及1.3.3版本通过**。

最终`node scripts/queued-prompt-smoke.mjs`退出0，证据`.impeccable/review/v133-queued-prompts-1795060125059/result.json`记录**16/16组、38次本地Responses请求、9截图、0renderer错误和实际重启**。Work自动队列两项FIFO通过；超过25MiB的附件替换失败后暂停并保留原附件，0次自动请求，手动恢复后才发送原附件；队列直接`@General`关联的真实child完成后才发送parent后续，parent历史只含initial/followup，child保留独立任务正文。普通直接`@`保持原行为，18项lifecycle测试覆盖不伪造parent run事件且不开放SubAgent queue。早期`1795059737286`在`backgroundSession`选择处超时，已通过的3组和0renderer错误保留为失败历史；原因是helper只展开`showAll`、未等待初始group展开，修正为轮询先展开group再`showAll`并滚动目标到可见，mention夹具也移除了错误要求复制parent history的`parentHistory`断言。最终完整运行在这些夹具修正后通过。先前v1审查finding因无确切历史shape或写入证据已撤回；未修改队列storage或schema。

已实际查看最终光轨日间、800px英文夜间及附件替换失败截图，未见队列控件遮挡或横向溢出。9份相关Markdown可解析，154个本地链接目标存在、0缺失；smoke临时profile进程已退出，用户原有实验实例未关闭。最后运行时代码变更后已完成上述完整测试、构建和桌面验证，之后只修正smoke夹具及文档。没有生成安装包，没有安装/升级、云写入、付费模型、正常用户profile/Key、Git提交或推送。

## 63. 2026-11-19 / 1.3.3 README 与 GitHub Release 文案

用户准备自行提交新版本，要求同步 README 并准备 Release 标题及简介。本轮整理 README 的版本亮点，按模式、办公格式、技能/本地插件、十条自动队列和快捷窗口组织说明；明确 Gemini 原生协议、Gemini/DeepSeek 缓存及 Word 表格原生公式属于 1.3.2 已有能力，避免重复计作 1.3.3 新增。修正旧快捷键说明把 `Ctrl+Alt+L` 也称作二键组合的表述，保留其默认三键和录制支持范围。

新增 [Release 文案](docs/RELEASE_1.3.3.md)，含中英文标题、简介、亮点及使用/升级说明。建议沿用 `V1.3.3` 标签，正文使用该标签的 GitHub 绝对文档链接；维护者发布时需将标签指向包含本版改动的最终提交。124 个 Work 物理来源与 104 种源正文 SHA、93 个名称分别说明，不当成 124 项独立原创技能；Office 能力仍按条件和实际支持范围描述，不声明完整安装/升级或所有第三方环境已验收。

本轮验证为文档检查：项目现有 Marked 成功解析 README 和 Release 文案，49 个本地链接/图片、6 个页内导航锚点、6 个固定标签链接对应的本地源码目标均存在；三处应用版本为 1.3.3，所列脚本与启动入口存在，差异空白检查通过。固定标签目标核对是本地文件检查，不代表远端标签已创建或发布。完整结果见[验证记录](docs/VALIDATION_1.3.3.md)本轮追加节。

本轮只修改 README、Release 文案、交接和验证记录，未修改应用代码、许可、版本、schema9、政策修订号、图标、用户数据或历史发布元数据；未重跑应用测试、构建或打包，未创建标签、提交、推送、发布 GitHub Release 或执行云 SQL。第62节完整测试及上一轮打包资源核对继续作为对应轮次证据。

## 64. 2026-11-19 / 1.3.3 已有安装包的发布 SQL

维护者已自行完成1.3.3打包，并提供 `https://github.com/SkyH1aa/MingshenHarness/releases/download/V1.3.3/MingshenHarness-1.3.3-x64.zip` 下载直链。本轮新增 [publish-release-1.3.3.sql](supabase/publish-release-1.3.3.sql)，沿用 `public.mingshen_app_releases`、0003迁移及同版本幂等upsert，填入版本、721字符公告、实际ZIP哈希、大小和直链。由维护者在已部署0003的Supabase SQL Editor手动执行，之后检查 `mingshen_get_latest_release_v2()`；本轮未执行云端SQL或确认线上发布状态。

实际本地ZIP修改时间为2026-11-19 12:13:13（Asia/Shanghai），大小 **318504814字节（303.75 MiB）**，完整SHA-256为 `39039e54ec234f0c23ce629a6cb81aac5f26f979a264ff6f60f390f245d12d90`。对同一只读共享ZIP流重算哈希、读取归档并与 `.zip.json`、`.zip.sha256` 核对，全部一致。ZIP根目录仅有 `MingshenHarness-1.3.3-x64.exe`，解压长度319403978字节，流式SHA-256为 `2d896db38745bfe292528e514441e204cc462d3f9291b49449d01a3b6f24c669`，与旁置EXE相同；只读Windows版本资源显示ProductVersion为1.3.3，没有执行安装器。

Supabase README、部署说明和[1.3.3验证记录](docs/VALIDATION_1.3.3.md)同步已生成实际包及本地发布材料的状态。第62、63节“未生成安装包”是智能体对应开发轮次的历史边界，不改写成智能体打包；旧1.3.2/1.3.1/1.3.0 SQL及元数据保持原样。新SQL的字段、URL、64位SHA、字节范围、公告1000字符约束、upsert和returning静态核对通过，差异空白通过。

本轮没有重新下载远端ZIP、重新打包、安装/升级、上传、执行云SQL、读取正常用户DB/Key、提交或推送；本地产物一致不代表远端文件已独立核验或安装升级已验收。重新构建或替换ZIP后必须重算哈希和大小。若云端仍有8.8.8等更高生效版本，需维护者确认后处理，不自动更改其他发布记录。

## 65. 2026-11-19 / 1.3.4 稳定性修复最终验证

本轮将版本从1.3.3升级到1.3.4，修复并回归七项已核实问题：DeepSeek thinking 与 `execute_tool_chain` 的供应商状态续接、原生 Memory 摘要预算与提交竞态、Native Sandbox 有界停止与 typed tombstone、会话目录 delta revision 恢复、宿主快照/Git 恢复的路径竞态、工具结果缓存 generation 条目以及持久命令 cleanupError/名额清理。随后补齐退出服务的 `Promise.allSettled` 结算、Chat 中断恢复的 evidence/barrier/并发/租约复核、只读 recovery inspection 限制、句柄级工作区 I/O 的 reparse/junction/NTFS 硬链接拒绝和临时文件原子替换。DeepSeek 内部执行步骤仍保留在本地历史和界面；发往 DeepSeek Chat 的历史会折叠回原始链根结果，不发送未由供应商返回的合成 call/result 对。

最终本地验证结果：串行 Vitest **150个文件通过、3个跳过；2001项通过、14项跳过**，退出0，用时243.95秒；`pnpm typecheck`通过；Biome **389个文件**通过；`pnpm build`通过，TencentDB固定源25个模块一致，main/preload/renderer产物分别为1,714.86 kB、31.47 kB、2,581.92 kB JS与365.61 kB CSS；`package-win.cmd --check`退出0，预检通过13,865项资源、生产依赖及1.3.4版本；`git diff --check`通过。测试中的最小沙箱替身同时兼容了显式恢复确认调用，真实ToolRegistry仍会确认持久命令和Native Sandbox。

最终构建后再次通过用户入口资源预检；文档收尾8份Markdown可解析、149个本地链接目标存在且无NUL，只读进程检查未发现本轮Vitest、Git或taskkill残留。

本轮未调用真实DeepSeek或其他付费供应商，未启动真实MXC、Docker、Office COM，未进行NSIS安装/卸载/升级或正式1.3.4安装包验收，未执行云SQL、访问正常用户数据库/API Key、提交或推送。多文件Git/快照操作仍不是数据库级事务，外部并发可能导致部分完成但会返回失败并保留安全快照；脱离受管会话的系统级daemon也不在Native Sandbox的保证范围内。正式打包仍使用仓库根目录的`package-win.cmd`，打包后必须重新核对1.3.4 ZIP的SHA-256、大小和内部版本，不能复用1.3.3发布材料。

## 66. 2026-11-20 / 1.3.4 ChatAgent 分组快速新建

用户要求 ChatAgent 同组点击加号直接沿用上一对话的模型信息，不再显示完整的新建弹窗；版本保持1.3.4，schema9、政策修订号`2026-11-04.3`、原子图标与用户数据目录不变。`SessionService.createChatSessionInGroup(groupId)`由主进程权威会话数据选择同组、未归档、无parent的最近更新Chat，不依赖搜索、分页或置顶显示顺序。空组回退全局最近更新的未归档Chat；完全没有Chat时选择首个已启用、支持text的模型，推理等级为null。继承供应商、模型、推理等级、systemPrompt和compactionModel，保持primary Profile、无workspace、host及Chat受限权限；历史、草稿、附件、扩展与运行状态均不复制。最新来源的模型或推理等级失效时明确报错，不静默改用旧来源。

新IPC为`session:create-in-chat-group`，经shared/preload/main接入，QuickChat白名单继续拒绝此接口。`App.tsx`、`ChatSidebar.tsx`及`ChatView.tsx`接入直接创建，移除`NewChatDialog.tsx`及其专属样式。具名分组和未分组标题都有加号，侧栏顶部和空态创建未分组Chat；成功后选中，新对话所在分组会展开并清除搜索。App级in-flight保护与disabled/loading防止连点重复创建，失败在侧栏显示且窄屏会打开抽屉。组标题保留完整title，加号、重命名和删除为独立32px控件，长组名不会挤占操作。

最终定向Vitest为**4文件37项通过**：`session-service.test.ts`、`session-catalog.test.ts`、`quick-chat-controller.test.ts`、`session-catalog-sync.test.ts`，退出0、2.60秒。Node/Web类型检查与Biome **388文件**通过；生产构建通过25份TencentDB固定源哈希，main **137**、preload **3**、renderer **2254**模块，产物main **1,717.71 kB**、preload **31.64 kB**、renderer JS **2,578.96 kB**及CSS **365.20 kB**，入口为`index-DvFymHUX.js`和`index-9s72hnjt.css`。用户入口资源预检退出0，**13,865项资源、生产依赖及1.3.4版本通过**。

最终真实Electron专项`scripts/chat-group-create-smoke.mjs` **10/10场景通过、17截图、0模型/fixture网络请求、0renderer异常、0fixture服务错误**，证据位于`.impeccable/review/v134-chat-group-create-1795095868403/result.json`。覆盖继承与内容隔离、空组和首次回退、归档排除、搜索/折叠复位、双击防重、失效错误和修复后重试，以及简约/光轨、中英文、日夜和1440/800抽屉。截图已逐张检查；独立临时profile已清理，测试Electron已退出。旧agent-modes和orbit-workbench smoke同步无弹窗流程，但未在本轮重跑其完整场景。机械设计检查仅报告共享CSS的10条既有建议，没有据此重构其他界面。

README、DESIGN、双语内嵌手册/日志、Release与验证记录已同步。本轮未重跑完整后端套件，第65节2001项保留为稳定性修复阶段证据，不与37项相加；未调用真实模型、接触正常用户profile/DB/API Key、生成正式NSIS/ZIP、安装升级、执行云SQL、提交或推送。桌面专项覆盖Chromium视口几何，不代表完整Windows DPI及辅助技术矩阵验收。当前源码使用`run-experimental.cmd`运行，正式打包仍由用户执行`package-win.cmd`。

收尾10份相关Markdown可解析、157个本地链接目标存在且无NUL；三处版本均为1.3.4，renderer入口与上述最终构建一致，差异空白检查通过。只读进程检查未发现本轮桌面专项或其临时profile进程残留。

## 67. 2026-11-20 / 1.3.4 审查清单与输入原文修复

用户要求修复已核实的审查清单，并确认粘贴后自动进入格式预览的问题。版本保持1.3.4，schema9、政策修订号、原子图标、用户数据目录及既有未提交修改保留。粘贴、键入、IME和快捷键不再自动打开预览，只有手动点击预览按钮切换；草稿恢复仍保留用户当时的原文/预览选择，图片粘贴继续作为附件。

项目JSON和Markdown Agent只从已信任工作区加载，项目来源不能覆盖内置Profile；工作区内的`{file:...}`及LSP打开文件使用有界、句柄级读取。编辑重发在外层savepoint内提交Workbench状态、历史删尾与新消息、草稿消费、标题/status及工具输出索引清理；准备或持久化失败回滚，已接受之后的模型失败保留本轮真实消息。Chat Completions必须收到正式`finish_reason`，仅`[DONE]`或非空内容不够，不执行截断流中的工具。

附件统一为每条最多10个、单文件25MiB、合计50MiB，覆盖Renderer读字节前、主进程、草稿和队列。文档提取使用最多2个worker、384MB堆及180秒硬超时；Office包、ZIP条目/XML、文本和PNG/JPEG完整性均有限制。Excel创建与编辑共享100,000单元格工作量预算；公式、主动字段、外部连接和嵌入工作簿有拒绝策略和递归预算。旧稿/模板与COM前验证共享嵌入XLSX检查，跨`instrText`拆分的主动字段按原样合并再检查。结构、重算、渲染分别记录，`partial/unavailable/failed`不能冒充`verified`，抽样截断不算完整验证。

Host命令取消/错误以有界进程树停止和close等待结算，未确认清理保留tombstone、写入屏障及恢复确认，大输出仍有有界头尾恢复。启动失败执行有界清理并失败退出；MCP Token POST拒绝重定向，编辑密钥留空保留仍声明的键；Skills市场拒绝过期响应。Headless建会话共用SessionService，派生会话走专用fork入口。ACP失败、中断和提前终态均结算，并发prompt不能覆盖；abort默认10秒有界，503、网络异常或超时以“远端停止未确认”结算，不给正常任务增加总时限。

Browser本地预览同时限制顶层和子资源的会话、provider、guest和工作区绑定；实验入口每次验证固定沙箱哈希并重建当前源码。插件市场用进程内队列、跨进程独占锁、UUID临时文件和替换后回读；正常等待锁最多15秒，超过60秒的锁只报告路径和人工恢复说明，不按mtime自动删除，不能在可能仍有writer时清理锁。

宿主文档保存使用目标/祖先句柄、旧SHA复核、同目录temp/bak及提交后identity/size/hash复核。Windows实现仍是有短暂gap的两步rename，不是无间隙原子替换或多文件事务。正常abort/timeout尝试`recover-write`；shutdown期间恢复服务不可用时明确失败并报告`RECOVERY_STATE`及`RECOVERY_BACKUP`，保留旧bak，不能承诺强杀、断电或所有退出路径均会自动恢复。

本轮最终完整串行Vitest退出0：**155文件通过、3文件跳过；2115项通过、14项跳过，337.84秒**。首轮6项失败分别由Office/流终态旧夹具、异步启动等待和中文取消提示导致，逐项修正并以三文件95项统一复测后完整重跑通过，未放宽安全合同。Node/Web类型检查、Biome **398文件**、生产构建及差异空白检查通过；TencentDB25份固定源一致，main141/preload3/renderer2255模块，main1801.61kB、preload31.64kB、renderer2581.32kB JS及365.20kB CSS，入口`index-C1HWG2pE.js`和`index-9s72hnjt.css`。构建后用户入口`package-win.cmd --check`退出0，**13,865项资源、生产依赖及1.3.4版本**通过。

最终真实Electron专项串行通过：原文粘贴**9/9场景、23截图、32组测量**，格式预览**11/11、8截图、6组测量**，两套均各1次本地fixture请求、0异常/崩溃/服务错误/意外网络请求，全部31截图已逐张查看。覆盖两种风格、三模式、QuickChat、模拟IME、原生编辑、附件超限预检及运行中队列替换；不操作系统剪贴板。Browser边界**6/6**断言通过，工作区内页面/资产正常且工作区外脚本/图片/iframe/fetch拒绝；真实ASAR的离线OCR、页渲染、旧DOC、Word公式/Markdown/图表/工作簿与DOCX/PPTX作者依赖闭包通过。具体路径、失败重跑和边界见[1.3.4验证记录](docs/VALIDATION_1.3.4.md)，定向数字与完整套件有交集，不累加。

文档收尾11份Markdown可解析、169个本地链接目标存在且无NUL，三处版本均为1.3.4；本轮测试进程残留为0，临时Browser审计副产物不存在。正常用户实例、历史临时目录及既有工作区修改均保留。

未调用真实付费供应商、Microsoft Office COM、MXC/Docker或正式NSIS安装升级，未访问正常用户profile/数据库/API Key，未生成发布包、执行云SQL、提交或推送；真实输入法、完整Windows DPI/GPU和辅助技术矩阵也不在本轮证明范围内。

## 68. 2026-11-20 / 1.3.4 ChatAgent 联网开关与 Crow5 调研

用户要求在 ChatAgent 中增加明确的联网允许/禁止按钮，允许时不再逐次弹出联网审批，并调研 Crow5 相对 Mingshen Harness 的功能差异；Crow5 部分只调研，不据此实施功能。版本保持1.3.4，不新增schema迁移，不改变CodeAgent/WorkAgent权限、图标或用户数据位置。

ChatAgent 会话级联网状态保存在现有`app_settings`，旧会话默认允许以兼容现有行为。主聊天与快捷 Chat 提供“允许联网 / 禁止联网”按钮，发送准备、任务运行或审批等待时锁定；IPC和SessionService均校验会话忙碌状态。允许时只向模型开放`web_search`、`web_fetch`，ChatAgent工具执行不再逐次审批，网页HTTP(S)/公网目标限制保持不变。禁用时工具定义不发送给模型，普通与受管工具路径都由主进程再次硬拒绝。分支、同组快捷新建及快捷 Chat 会话续期继承来源会话的禁网状态，无来源的新Chat默认允许；队列派发读取发送时会话设置，不保存排队时的联网授权快照。

该开关只控制ChatAgent主动调用的网页搜索/读取，不阻断模型供应商API、更新检查或提交用户附件所需的网络；不得描述为应用整体断网。README、SECURITY、双语使用手册、双语更新日志及1.3.4 Release文案同步该边界。

Crow5 调研见[Crow5与Mingshen Harness功能对比](docs/CROW5_COMPARISON_1.3.4.md)。报告按Crow5官方当前首页、官方手册数据、官方自述和第三方资料分级，并以本仓库实现作为Mingshen基线。主要差异为Crow5公开的统一创作工作站、可视化多Agent协同、统一命令面板、可交互多标签终端、策划型Skill/MCP市场、代码时间线/单文件回退和图片无限画布；Mingshen更明确的优势为ChatAgent隔离、Office受控编辑与验证、本地插件SDK、后台SubAgent、自选模型及权限/恢复闭环。官网“500+ Skills”“200+模型”保留为宣传口径，官方手册v6.46.0适用于较早的v1.3.22说明，未将手册全部能力假定为v1.3.31实测。没有安装Crow5、做同任务基准或根据报告修改Mingshen产品功能。

本轮联网开关最终串行Vitest退出0：**155个文件通过、3个跳过；2121项通过、14项跳过，453.62秒**。Node/Web类型检查和Biome **398个文件**通过，生产构建main141/preload3/renderer2255模块及25份TencentDB固定源校验通过；`package-win.cmd --check`通过13,865项资源、生产依赖和1.3.4版本。真实Electron联网专项3/3、8张截图、0模型请求和0renderer异常；证据及布局覆盖见[验证记录](docs/VALIDATION_1.3.4.md)。宽范围Orbit smoke在前9项通过后，任务面板复载600px/ARIA断言超时于联网场景之前，原因仍待查；专项联网smoke通过不替代该未通过的完整布局场景。定向Quick Chat/SessionService新增断言与全量结果有交集，不相加。

Crow5报告仅为公开资料对比；没有安装对手产品、跑性能基准或据此实施产品功能。没有调用真实模型、访问正常profile/Key、执行云SQL、生成/安装NSIS、提交或推送。测试Electron和临时profile已退出/清理，用户已有服务进程未触碰。最终10份Markdown、153个本地链接、diff空白、脚本语法、Node/Web类型、Biome398文件及13,865项1.3.4打包资源预检均通过；无正式安装包。

## 69. 2026-11-20 / 1.3.4 创作工作面与项目协作扩展

用户确认继续实装创作工作站、生图工作台、AutoDrive、多角色并行总控、统一命令搜索、交互式多标签Shell、行评论审阅、分支/worktree项目视图和草稿辅助。版本保持1.3.4，schema9、政策修订号、原子图标、用户数据路径和现有框架保留。新增产品说明使用自身功能名称，不将外部产品名称作为实现或质量保证。用户曾提供带认证参数的外站链接；源码、文档和测试只使用公开页面或本地合成夹具，不保存该认证信息。

### 源码入口与合同

- `shared/creative-templates.ts`、`CreativeWorkstation.tsx`：348个原创工作流/内容模板，按任务类型匹配使用场景、章节意图、交付流程和验收要求；不是348份预渲染Office二进制文件。需求和章节可编辑，支持撤销重做、JSON导入导出及工作区草稿保存。交给WorkAgent只加入输入区，保留已有正文和附件，用户发送后才开始实际制作；取消选目录或草稿冲突不得显示交接成功。写入失败的草稿在同renderer切页后可恢复，成功持久化后清理恢复副本；持续失败时必须在刷新/退出前重试或导出。损坏/不可读的存储原值不覆盖，初次blocked且无失败副本的编辑只留当前工作面。空章节标题允许保存恢复。交接等待草稿保存及目标身份复核，失败在原页面显示，重试不重复追加；异步切会话不抢回旧目标。
- `main/image-studio/`、`main/providers/image-generation.ts`、`ImageStudio.tsx`：BYOK图片模型与语言模型分别选择。图片配置通过outputModalities区分，文本会话入口排除仅图片输出模型；生图使用OpenAI Images兼容接口，要求Base64图片，不追随供应商远程图片URL。润色先预览确认再生成，反推要求支持图片输入的语言模型。本地素材只存入固定userData子目录；画布支持平移缩放、图层编辑和带素材的工程导入导出。GIF是已选图片帧合成，不宣称文本到AI视频。
- `main/chat/auto-drive-service.ts`、`shared/autodrive.ts`：显式点击后，由当前模型结合历史、持久计划及有界仓库证据，只读提出3至5种不同方向。没有文件修改或命令工具，选择方案只交给草稿；任务活动、取消、会话删除和退出需统一结算。worktree模式只使用已建立的实际目录；尚未建立时明确失败，不调用`worktreeService.ensure`、不创建目录、不回退主工作区。读取遵循Profile权限，并在证据读取后及模型请求前再次核对。
- `main/chat/coordination-service.ts`、`shared/coordination.ts`、`ChatService.coordinate_agents`：模型明确拆解2至6个工作包并指定可用角色，使用真实子任务调度，并受已有并发上限、审批和文件写入租约约束。父Agent安排后可继续独立工作，再用wait_subagents补收。验证命令、独立QA和质量状态分别保存；缺少实际验证、命令受阻或失败均不能只凭QA文字标成通过。
- `CommandPalette.tsx`、`ProjectNavigator.tsx`、项目导航与搜索服务：Ctrl+Shift+P汇总当前模式可用命令、历史会话和工作区文件。项目图标、未读标记及分支/worktree视图沿用会话的实际记录；未记录的历史会话不能凭当前checkout伪造旧分支归属。
- `main/terminal/terminal-service.ts`、`InteractiveTerminal.tsx`：node-pty/ConPTY加xterm的真实交互Shell，多标签、输入、调整尺寸及停止。只允许主窗口主动创建、可信Code/Work项目、host或实际worktree、Full Access且非patch-only；不是新增模型工具，不对Chat、小窗或实际子Agent开放。窗口、会话和应用退出需要确认进程清理，失败保留可重试状态并显示错误。
- `main/workspace/local-review-service.ts`、`LocalReview.tsx`：Git、Branch、会话、上一轮四种范围；旧/新行编号、多行评论及版本指纹。发送前重新核对文件和diff，变化后保留评论并要求刷新；只有草稿持久化成功后才清空待交接评论，不自动发送聊天。
- `main/agents/draft-assist-service.ts`、`ComposerAssistControls.tsx`：独立润色模型、原文/建议预览、显式应用、单次临时指令和按工作区保存的语气。临时指令进入本次运行的低优先级上下文，随相应队列项保存，不改写历史正文或影响之后轮次；不能扩大任何工具或权限。

### 依赖与验证状态

新增生产依赖为node-pty1.1.0、@xterm/xterm6.0.0、@xterm/addon-fit0.11.0、gifenc1.0.3、sharp0.35.5及diff9.0.0；许可与用途记入THIRD_PARTY_NOTICES。终端与图片解码的原生模块及运行时DLL必须进入生产依赖闭包和asarUnpack检查，不能以开发机能加载替代包内校验。生图资产需要有界完整像素解码，GIF/WebP逐帧检查，暂不支持APNG。GIF编码核心使用成熟库，包装层继续限制帧数、像素和输出大小。本地审阅固定HEAD对象与受保护文件字节后在内存计算diff，并限制时间、编辑量及输出；Git配置和对象数据库仍是信任边界。

此节为本轮接续入口；最终完整测试、桌面场景、构建和资源预检数字统一追加到[1.3.4验证记录](docs/VALIDATION_1.3.4.md)本轮节。第68节2121项和既有Orbit smoke失败均属前阶段记录，不自动证明新增工作面已经验收。未生成正式NSIS/ZIP、未安装升级、未执行云SQL、未使用真实模型凭据或正常用户profile，也未提交或推送。

本轮完整串行Vitest最终退出0：**177文件通过、3文件跳过；2312项通过、14项跳过、0失败，411.88秒**，含LSP早到错误、真实ENOENT/EPIPE及关闭结算修复。完整套件之后的界面收尾修复了矮审阅面板评论按钮进入执行区、800px生图属性栏遮挡画布工具，以及更新提示和快捷键警告同时出现时的Orbit顶栏重叠；保留严格矩形/裁切/命中断言，不以中心可点替代完整可见。`studio-navigation.css`必须在`main.tsx`主题样式之后导入，避免相同特异度规则被覆盖。

最终Node/Web类型、Biome **457文件**、生产构建通过，TencentDB25份固定源一致；main157/preload3/renderer2290模块，产物分别为**1,997.89 kB**、**35.97 kB**、renderer JS **3,446.71 kB**及CSS **453.37 kB**，入口`index-D8KAw9p-.js`与`index-mD0ncncx.css`。真实工作流专项**12/12、5截图**；项目审阅专项**8/8、10截图、41组测量**；最新版创作/生图专项**14/14、32截图、180组几何记录**，合成更新提示与快捷键警告同时显示、800px双面板及680px抽屉边界均通过。路径及中间失败保留在验证记录，旧7/7审阅与13/13创作结果不是最终布局证明。ASAR夹具实际验证sharp像素解码、gifenc编码、diff及ConPTY输入/resize/退出；图片许可/打包专项9/9通过，但不是正式electron-builder安装成品验收。

最终构建后`package-win.cmd --check`退出0，**13,865项资源、生产依赖及1.3.4**通过。11份相关Markdown可解析、171个本地链接存在且无NUL；三处版本、最终renderer入口及diff空白检查通过，本轮桌面/ASAR测试进程残留为0。真实收费供应商、Office COM、MXC/Docker、完整Windows DPI/GPU/辅助技术与正式NSIS安装升级仍未验收；用户可用`run-experimental.cmd`运行源码，正式打包由用户执行`package-win.cmd`，完成后重新读取新ZIP的SHA、大小和内部版本。

工作流5张、审阅10张、创作/生图32张最终截图均已逐张复核，未发现新的明显遮挡；创作/生图主流程另抽查4张代表图。静态复核仅覆盖截图位置及面板状态，实际指针、完整矩形与滚动另由专项覆盖，不外推完整键盘、DPI或辅助技术验收。最新创作专项的全部命令结束，临时profile和测试进程已清理。

## 70. 2026-11-20 / 1.3.4 运行中引导

用户要求像现有Agent产品一样，在任务运行中发送补充信息而不停止模型。版本保持1.3.4，schema9、政策修订号、图标、用户数据路径及已有未提交修改保留。原有下一轮队列仍用于当前运行正常完成和清理之后的独立消息；本轮引导作用于当前run的后续模型请求，两者不共用派发时机。

### 行为与边界

- 主Code/Work/Chat及快捷Chat提供单独的发送引导动作，保留停止和下一轮队列。只有实际主模型任务接收引导，手动压缩、独立AutoDrive和实际SubAgent会话不开放。
- 引导只包含文字，附件和单轮临时指令需另行处理，不在后台丢弃。斜杠命令、`@`和手动扩展引用保留为普通文字，不触发配置、模型、权限或模式切换。沿用当前会话的权限、联网开关、审批、隔离和上下文预算。
- 每条最多8,000字符，等待接入最多10条，同一run累计最多32,000字符。提交绑定sessionId、runId和幂等requestId；过期run、收尾、停止或不支持的会话直接拒绝。草稿revision、实际正文和附件状态需在事务内复核，入队与消费草稿一同提交，失败保留草稿。
- 当前模型请求、工具批次及子任务继续运行；引导在完整的assistant/tool结果边界之后按FIFO加入，不能插入未完成的工具调用与结果之间。若当前模型返回最终文本而仍有待接入引导，则在同一run内继续模型请求，不能通过重建run假装保持连续运行，也不能绕过已有工具轮数预算。
- 状态区分等待接入、已接入和未应用。已接入表示进入本次后续请求上下文，不等于模型完成要求或外部服务确认执行。停止、失败或重启时，未接入内容可恢复且不自动重发；后来启动新run也不能静默清空旧的未应用正文。删除会话会清理该会话的持久引导记录。
- 主窗口与快捷窗口的事件、初次加载和迟到回执需按会话及run身份核对，不清空新的草稿、重置正在流式显示的输出或把已结束任务变回running。草稿接受事件与IPC成功回执可能同时到达，应保持幂等。

### 入口与验证记录

共享协议为`shared/run-steering.ts`，经`chat:steering-get`、`chat:steering-send`及preload接入ChatService。快捷窗口只允许自身有效会话，主进程仍负责全部运行和输入校验。Renderer使用`use-run-steering.ts`与`RunSteeringTray.tsx`显示等待和恢复内容，ChatView保留原有输入与队列流程。

本轮最终完整源码检查、真实Electron专项、文档和资源预检统一记录在[1.3.4验证记录](docs/VALIDATION_1.3.4.md)“运行中引导”节。历史第69节的完整测试和构建产物不能替代新增行为的本轮验证。正式安装包由用户执行`package-win.cmd`生成，未在本轮自动打包、安装、提交或推送。

2026-11-21收尾：本轮完整串行Vitest第二次运行退出0，**179文件通过、3文件跳过；2350项通过、14项跳过，0失败，396.83秒**；根脚本套件**98项**、Node/Web类型和Biome **463文件**通过。首次全量的审批测试超时及清理竞态已限于夹具修正，并保留失败记录。原有自动队列真实Electron回归**16/16、9截图**通过。引导首次功能复跑12/12，但截图复核发现Code/Work顶栏模式未被夹具正确激活，不能据旧场景名声称完整模式覆盖；修正后最终专项**12/12、7截图、7组测量、16次模式/会话一致性校验**通过，18次本地fixture请求中只有显式Stop提前关闭，0异常/崩溃/意外网络。全部16张最终引导/队列截图已逐张复核；英文Chat侧栏仍有少量既有中文，窄屏队列说明有省略显示，不代表完整本地化或辅助技术验收。

最终生产构建通过，TencentDB25份固定源一致，main159/preload3/renderer2293模块；main2,015.02kB、preload36.24kB、renderer JS3,466.41kB及CSS455.14kB，入口`index-BUZa0a33.js`/`index-BvW2yLct.css`。构建后`package-win.cmd --check`退出0，**13,865项资源、生产依赖及1.3.4版本**通过；11份Markdown、174个本地链接、三处版本及差异空白核对通过。本轮测试进程和临时profile已清理，既有用户实例保留。正式NSIS/ZIP、真实供应商、原生IME、完整DPI和辅助技术仍不在本轮证明范围内；打包由用户执行，源码预检不是安装升级验收。

## 71. 2026-11-21 / 1.3.4 工作站模板、Skill 版本与会话侧栏

- 保留原348个模板ID，新增432个场景；65种任务结构，每种12个场景，覆盖12类。每个场景均有简略版和详细版；详细版由独立场景的资料、任务、交付、风险及所属业务流程组成，并写出相应真实技能ID和适用理由。中文默认详细提示词按汉字核对，不能用标题、标点或英文型号凑数。
- 草稿`promptMode`是可选字段：新建为`detailed`，旧草稿缺字段时按`brief`读取。不迁移或重写旧JSON，不因版本切换丢弃主题、备注或章节。两版共用预览、复制及追加输入框逻辑；WorkAgent交接不发送消息、不改变工具授权。仅Code配置不能被静默替换以绕开兼容性检查。
- 模板数据、组合逻辑及回归位于`shared/creative-template-*.ts`；UI位于`CreativeWorkstation.tsx`，索引逻辑位于`creative-template-search.ts`。分类、格式及多关键词取交集，列表分页。仅当前草稿生成全文，避免为整库生成长提示词。各类Office协作产品按可用文件交付离线稿、规格或交接材料，不承诺原生专有格式和云端操作。
- 工作来源Skill仅在同一来源路径去掉唯一合法SemVer目录后完全一致时合并；不同路径、独立变体及来源仍可选。124份物理来源不删除，活跃发现和手动列表只显示同源最新版。`domain-skills.ts`和`session-builtin-capability-service.ts`负责活动目录、旧选择和上限，相关权限检查也覆盖运行与提示注入。针对旧ID有效且不匹配当前ID的明确范围规则只继承deny/ask，不继承旧allow或通用兜底；无论是否固定选择，取消或重选都不绕过旧限制。详情及测试证据见[1.3.4验证记录](docs/VALIDATION_1.3.4.md)。
- `workbench.css`将Code/Work会话侧栏控制区收紧到自然高度，只有会话列表伸展与滚动。不改Chat独立布局，也不改变分支、worktree和会话过滤逻辑。全量源码、真实桌面专项和打包预检均记录到验证页的新节，不引用第70节作为本次结果。

模板库最终默认中文详细提示词为1,128–1,454个汉字，平均1,246.67；同类模板共享专业流程及格式规则，不代表每项独立撰写800字，用户编辑后长度可变化。保留原348个ID和简略方式，目录按780个独立场景计数。Work来源保留124份物理资源，发现和手动选择展示98个活动来源，独立用途变体保留。收尾校正FTE口径和纯空白字段回退；模板/索引/绑定/持久化定向4文件48项通过。最终侧栏与项目审阅桌面专项10/10、20截图、60组测量通过；前两次夹具失败及实际边界均保留在[本轮验证记录](docs/VALIDATION_1.3.4.md)。

最终源码完整串行Vitest再次通过：181文件、2379项通过，3文件/14项环境跳过，0失败，391.58秒；根脚本98项、Node/Web类型、Biome479文件通过。生产构建main159/preload3/renderer2306模块，main2,021.39kB、preload36.24kB、renderer JS4,672.06kB/CSS458.94kB，入口`index-28RWupbL.js`/`index-CsLwKf3k.css`；资源预检13,865项与版本1.3.4通过。最终工作站/生图专项19/19、55截图及466组几何记录通过，6次本地合成请求、0页面/服务异常及0意外原生下载；全部截图已逐张复核，含三种布局的简略态、展开提示词原生滚轮到底及目录/预览打开状态。实际证据与未验证项统一记于验证页本轮节；未逐一评审780种真实Office成品，未调用真实收费模型或Office COM，没有正式打包、安装、提交或推送。

文档收尾12份Markdown、177个本地路径链接、28个标题锚点、三处版本和最终renderer入口核对通过，diff空白检查通过。两份桌面专项对应脚本/临时前缀的匹配进程及Temp目录均为0；正常实例、历史目录及已有工作区修改保留，查询范围及清理证据边界见验证页。

## 72. 2026-11-21 / 1.3.4 node-pty 打包重编修复

用户正式打包日志在资源预检后失败于`@electron/rebuild`重编node-pty的`MSB8040`：Visual Studio缺少Spectre缓解库。此前`--check`与自制ASAR夹具不能证明此阶段成功，保留为历史范围。当前node-pty1.1.0官方包已经包含Windows x64 Node-API预编译，官方install也优先使用预编译；不修改上游binding.gyp、防护、DLL或系统组件。

新增`package-native-dependencies.cjs`：对照锁文件SHA-512验证过的npm官方归档，固定校验7份预编译二进制SHA-256；源预检和afterPack共用验证，补查console-list绑定及JS入口。拒绝两套build/Release、Debug路径中的12种优先旧绑定；不删除用户依赖。通过electron-builder自身依赖锚点解析rebuild4.2.1，以同等prod/optional、sequential、Electron45.2.1与win32/x64选项，仅排除已校验node-pty。按照上游真实目录命名规则检查所有将被排除的实例，并在重编后重扫，目录集合变化即拒绝。任何失败不启动builder；成功后才传`npmRebuild=false`避免重复重编，保留正常生产依赖收集。不使用会关闭依赖收集的`beforeBuild`返回false方案。

真实`package-win.cmd --dir`退出0，生成`%LOCALAPPDATA%\MingshenHarness\BuildCache\windows-1.3.4-QbDHsf\output\win-unpacked\MingshenHarness.exe`，afterPack全部资源及生产依赖检查通过，EXE版本1.3.4。根脚本整套108项通过（含新增10项），0失败/跳过，48.04秒。`feature-asar-smoke.cjs --archive <实际app.asar>`在隔离Electron45.2.1中使用真实包内依赖，通过ConPTY输入/resize/退出及PID消失、sharp PNG/GIF解码、diff与gifenc；禁止回退宿主依赖。最初探测错误要求README仍在node_modules，但builder按既有配置将它保存在third-party-notices，夹具已分别核对实际布局；生产校验未放宽。此轮只改打包脚本、验证脚本和文档，不重跑全仓Vitest并冒称本轮2379项；源码版本保持1.3.4，未生成正式NSIS/ZIP、安装升级、提交或推送。最终检查见验证页新节。

## 73. 2026-11-21 / 1.3.5 简约主题、启动展示与桌面宠物

用户要求将当前版本升级为1.3.5，收紧默认“简约”主题，并加入可关闭的启动展示和可选桌面宠物。版本升级为1.3.5；schema、协议修订号、原子应用图标、用户数据路径和既有 Code/Work/Chat 能力保持不变；本节只记录源码入口与行为边界，完整命令结果以[1.3.5验证记录](docs/VALIDATION_1.3.5.md)为准。

### 源码入口与行为

- `apps/desktop/src/renderer/src/simple-workbench.css`：简约主题的局部布局和空任务区域收缩规则。该文件在现有主题样式之后加载，不能用全局规则覆盖光轨布局；没有计划或子任务时不保留大块空占位。
- `apps/desktop/src/main/desktop/startup-presentation.ts`、`apps/desktop/src/shared/startup-presentation.ts`、`apps/desktop/src/renderer/src/StartupApp.tsx`：启动展示控制器、IPC 阶段协议和独立 Renderer。默认值为开启（只有设置值严格为`false`才关闭），设有从控制器启动起约8秒的兜底，但定时器不能硬抢占同步磁盘I/O；可信窗口可以跳过。准备、服务、窗口和进入工作区阶段由主进程发送，加载失败、关闭或超时只结束展示，不以展示失败阻塞主窗口启动。启动页使用现有原子标识的动画表现，系统减少动态效果时保留必要状态文字和焦点。
- `apps/desktop/src/main/desktop/companion-controller.ts`、`apps/desktop/src/shared/desktop-companion.ts`、`apps/desktop/src/renderer/src/CompanionApp.tsx`：桌宠主进程状态机、共享偏好协议和透明独立窗口。默认关闭；开启后支持置顶、透明度、96–320px大小、拖动、工作区内位置钳制、位置恢复、问候、闲聊频率、闲置休息和通用任务提示。桌宠状态只映射开始、处理中、等待确认、完成、失败、休息等通用事件，不读取或展示模型回复、文件内容、路径、命令参数或审批细节。窗口关闭和应用退出会清理定时器与监听器，偏好仍保存在本地设置。
- `apps/desktop/src/renderer/src/components/DesktopExperienceSettings.tsx`：设置 → 桌面体验入口。启动展示和桌宠偏好独立保存；桌宠保存失败会保留待重试修改，状态事件按服务端基线、在途补丁和排队补丁合并，迟到事件不能覆盖更新的本地编辑。
- `apps/desktop/build/installer.nsh`、`apps/desktop/build/installer-header.bmp`、`apps/desktop/build/installer-sidebar.bmp` 及 `apps/desktop/build/installer-atom-mark.png`：Windows 安装器品牌资源和欢迎页动画脚本。资源预检与界面夹具不等于正式 NSIS 安装、升级、卸载或动画运行验收；正式包必须用本次源码重新执行`package-win.cmd`并读取产物元数据。
- 后续桌宠动作素材、透明帧验收、右键菜单和播放器接线方案见[桌宠动画素材制作指南](docs/COMPANION_ANIMATION_ASSET_GUIDE_1.3.5.md)。在本节对应的早期阶段，右键菜单和动作播放器尚未接入；后续实现与验证见第74节及1.3.5验证记录。

### 当前验证边界

最终 Node/Web 类型检查和 Biome 494 文件通过；桌宠/启动定向 2 文件19项通过，根脚本整套119项通过（含安装器4项及UI-only编译夹具）。生产构建退出0，main163/renderer2319模块、3个独立preload/3个HTML，入口`index-C0yzxWSu.js`/`index-CJ5P6Gmd.css`；桌面资源专项与13,865项资源/生产依赖/1.3.5预检通过。最终真实Electron专项7组、17截图通过，0Renderer异常/console error；覆盖简约日夜/紧凑窗口、光轨切换、启动设置重启、桌宠透明像素、三档大小、PNG/SVG对齐、正常帧差和减少动态效果静帧、Enter轻拍及真实Pointer拖动。轨道裁切已修正；隐藏状态条不做可见几何断言，仍记录实际样式并严格检查可见元素。96px信息较密，不能把截图和DOM检查外推为完整DPI/辅助技术验收。

较早完整串行Vitest183文件、2396项通过是阶段结果。最终源码完整串行回归退出1：176文件通过、7失败、3跳过；2389项通过、9失败、14跳过，627.24秒。失败7文件单独复跑仍121通过/9失败，312.45秒，涉及Windows junction/linked snapshot/真实PowerShell及EBUSY清理超时，不能宣称最终全量通过或无证据归因于负载。具体失败、阶段日志、本地截图路径和验证范围见[1.3.5验证记录](docs/VALIDATION_1.3.5.md)。安装器UI-only EXE被Windows拒绝运行，正式欢迎页轮播、安装/升级/卸载没有运行验收；未生成正式NSIS/ZIP，未推送、发布或执行SQL。

收尾补查中，最小Vitest junction探针、文件搜索junction、guarded static junction、guarded hard-link/reparse及真实PowerShell停止用例各自单独通过；但终端整文件复跑仍24通过/2超时，伴随EBUSY，根因未确定。这些补查不替代最终全量失败状态。对应测试进程已结束，未放宽安全断言或修改相关产品/真实测试；交付前再次类型检查和13,865项资源/生产依赖/1.3.5预检通过。

本轮有一次未经要求的本地提交`e6f58016 fix: make companion preference saves retryable`（桌宠控制器与测试两个文件），未推送；接续不要reset/revert或继续提交。其余工作区修改保留。试用入口为`run-experimental.cmd`，正式打包由用户执行`package-win.cmd`，不得用既有安装包或第72节1.3.4的证据替代。

### 桌宠视频素材指令补充

用户随后要求自行按现有桌宠生成各种交互视频。本轮新增[36段桌宠图生视频完整指令集](docs/COMPANION_VIDEO_PROMPTS_1.3.5.md)，保留原序列帧指南并增加互链。视频路线统一母版、首尾锚点、24/30fps源视频、纯色/Alpha处理、36段独立动作、三批生成顺序及右键菜单对应建议；明确持续状态的进入/循环/退出、左右朝向不可镜像、坐姿与悬空配准及循环实际验收。此轮只整理素材指令与交接，不新增运行时代码，不声称视频导入、完整右键动作菜单或漫游已接入；版本仍为1.3.5，不重复执行应用测试或打包，第73节既有验证边界继续有效。

## 74. 2026-11-21 / 1.3.5 桌宠视频动作、原生菜单与全屏启动

用户已提供36段角色视频，本轮将它们接入桌宠动作系统，版本保持1.3.5。第73节及其素材指令补充描述此前阶段，不再用于判断本节动作和菜单是否存在；本轮实际资源、构建和桌面验收统一追加到[1.3.5验证记录](docs/VALIDATION_1.3.5.md)。原始`36个桌宠动画/1.mp4`至`36.mp4`须完整保留，不覆盖源视频，不自动生成正式安装包或提交源码。

- `renderer/src/CompanionVideo.tsx`及`lib/companion-motion.ts`提供36动作映射与双视频槽播放；按任务状态、拖动、手动互动及休息切换进入、循环和退出片段。隐藏、停用动画和系统减少动态效果时释放媒体，加载超时或失败回退原角色静图。行走是动作预览，不代表自动桌面漫游；模型生成导致的身份、手部和姿态差异不因统一画布或去色自动修复。
- `main/desktop/companion-menu.ts`构建原生右键菜单，提供匿名任务及会话跳转、主窗口、快捷ChatAgent、互动、状态预览、休息/唤醒、置顶、位置锁定、大小、不透明度、动画开关、设置、暂时隐藏和持久关闭。桌宠只接收通用任务状态，不展示正文、路径、命令参数或审批细节；手动休息不停止Agent，预览不改写真实任务结果。
- 主进程和受限preload分别校验桌宠菜单、快捷Chat及动作IPC；快捷Chat仍沿用原有会话及权限边界。任务跳转不在Renderer接受导航前提前标记已读；桌面设置入口遵守既有未保存内容保护。设置保存失败的补丁和重试入口独立保留，显示/隐藏不能吞掉保存错误；输入中的休息分钟草稿不被任务事件覆盖。拖动设阈值并逐帧合并移动，外部锁定时清除捕获和拖动状态。
- 启动窗口使用主屏完整bounds与置顶等级，保留原子标识。轨道从屏幕边缘汇聚，真实阶段及跳过支持中英文；主窗口就绪后在动画下方显示，退场透明渐隐。正常展示按4,680ms可见等待加320ms退场控制为约5秒；500ms加载宽限、8秒总生命周期保护及失败放行分别处理，用户可提前跳过。慢启动、加载失败和同步磁盘I/O不保证精确5秒；完整DPI/GPU/多屏与正式安装升级另行验收。
- 动画显示后以`setImmediate`调度可选SQLite索引预读，仅在已同意协议、展示仍活跃且应用未退出时复用已有连接。两条固定的覆盖索引查询各`LIMIT 32`，只取常量，分别覆盖未归档顶层会话目录及Chat目录；不读取正文或凭据，不生成应用级缓存快照。临时将`busy_timeout`设为0并在`finally`恢复，失败不阻止启动。数据库打开及迁移仍在展示之前，索引页预热不等同完整首屏加载或性能提升证明；锁等待预算不构成对同步磁盘I/O的抢占时限。
- 首次未同意时，三份协议的读取等待本次启动展示结束，且主窗口原生`isVisible() && !isMinimized()`确认后才放行；`show()`调用完成或后台`showInactive()`都不能单独释放计时。`startup-reveal-gate.ts`默认以最多80次、每次25ms的有界轮询确认窗口可见；同一代际并发请求合并，取消、重载或窗口替换使旧代际失效，新的有效请求可立即重启。主窗口先`showInactive()`再`show()`；Windows真实运行曾发现跳过早于主窗口ready时`show()`返回但`visible=false`，已改为等待可见性后再放行。`DesktopController.policy`在异步文件读取后、改变计时或手册状态前再次检查。保留主进程与界面各自至少5秒门槛，避免5秒启动动画抵扣阅读时间；退出因草稿落盘失败而取消时恢复尚未完成的主窗口显示。
- `scripts/package-desktop-surfaces.cjs`检查三组HTML/preload及36个动作的字节、SHA和实际Renderer入口依赖图；源码存在或静态WebM签名不代表Alpha解码成功，必须结合真实Electron逐段解码检查。

动作调度修复前阶段的完整串行Vitest退出0：186文件通过、3文件跳过，2438项通过、14项环境跳过，0失败，336.57秒；报告位于`.impeccable/review/v135-companion-full-vitest.json`。该结果不覆盖后续`greeting`到`idle`切换误清排队跳舞的修复。第73节此前全量超时失败仍为真实历史结果，不改写为通过；本轮也没有为通过测试放宽那些边界断言。素材验收、后续构建和真实桌面检查继续以验证记录的本节追加结果为准。

36段最终WebM为720×720、24fps，合计31,863,747字节和4,404帧；第20/22段各145帧约6.042秒，其余各121帧约5.042秒。`scripts/prepare-companion-motions.cjs`通过显式指定的开发期FFmpeg/FFprobe执行有界流式解码、边界连通去红底及VP9 Alpha编码；不捆绑外部媒体运行时。`scripts/companion-video-key.cjs`固定去色算法，第21段先去底，再缩为512×512并放入720×720透明画布的x101/y208位置。清单`renderer/companion-assets/motions/manifest.json`逐条记录来源/输出SHA、大小、帧数、时长及采样；清单SHA为`98924497d6317c325fed0afb67fcb636d674333994a47669d80a3d49843d5f37`。透明样本中alpha=1仍会计入大于零的统计，不能用它推定可见角色面积。全部浅/深背景接触表已查看，部分手指/皮肤边缘有抠像损失及轻微红边，源视频角色、服饰和姿态差异保留；不保证无损抠像或无缝衔接。

素材就位且动作调度修复前的阶段中，根脚本完整套件137项通过、0失败/跳过，25.99秒；Biome500文件通过。该阶段生产构建退出0，main164模块/2,072.86kB、renderer2358模块，三组HTML/preload及36段动作的入口可达性与SHA检查通过；13,865项资源、生产依赖和1.3.5版本预检通过。主入口为`index-DZcYCaeS.js`/`index-CJ5P6Gmd.css`，桌宠为`companion-nF_tdeLQ.js`/`companion-BQvzCU6b.css`，启动为`startup-DiQLLh_R.js`/`startup-s2DYVeUi.css`。这些是该阶段源码构建证据，不覆盖后续动作调度修复；真实Electron逐段播放、菜单和全屏展示的结果仍按验证页后续记录，不等于正式安装/升级验收。

动作调度随后修复了问候结束时清空待播互动的问题：普通状态切换保留待播手动动作，拖动、休息、成功、失败及明确取消仍按规则中断；任务徽标立即反映真实状态，工作动画可能等待当前互动结束。动作调度修复后、启动可见性修复前的阶段全量为188文件通过、3跳过，2,453项通过、14项环境跳过，0失败、311.09秒；报告见`.impeccable/review/v135-five-second-final-vitest.json`及同前缀日志，不能取代后续最终回归。启动可见性修复后的最终完整串行Vitest为188文件通过、3跳过，2,460项通过、14项环境跳过，0失败、318.75秒，报告见`.impeccable/review/v135-startup-complete-final-vitest.json`及同前缀日志。最新根脚本套件137项通过、0失败/取消/跳过，30.25秒；Node/Web类型检查、Biome504文件、生产构建、桌面入口资源检查及13,865项/1.3.5打包资源预检通过。最终Electron专项为22组、88张截图、68组几何记录、36/36动作解码、0异常与0 console error，结果与范围见[1.3.5验证记录](docs/VALIDATION_1.3.5.md)。首轮smoke清理遇到迟到本地SSE夹具请求，已调整夹具收尾等待请求结算，未改产品断言；保留中间失败及历史全量超时，不据最终单次通过推断原超时根因消除。生产构建和资源预检不替代正式NSIS安装、升级或卸载验收。

## 75. 2026-11-22 / 1.3.5 桌宠任务面板、待机互动与 Chat 批量管理

版本保持1.3.5。本轮在既有桌宠基础上增加真实工作会话列表、状态和本地耗时，支持折叠与可靠跳转；同一会话的多项运行合并，等待确认优先。标题默认显示，可在桌面体验设置或菜单关闭；成功保存后主进程先脱敏，桌宠IPC标题为`null`，面板与菜单使用匿名名称。标题本身可能敏感，关闭但保存失败时仍可能显示，设置页明确标注尚未生效。桌宠不接收正文、目录、命令参数或审批详情；跳转须由主界面实际接受，失败、未保存计划拒绝、页面重载、超时与并发会有回执，不能提前标记已读。

- `companion-controller.ts`计算真实工作区内的窗口几何并通过`state.layout`传递有效角色尺寸与面板高度；小工作区的适配不改用户保存的96–320px大小。显式`enabled:true`在窗口创建或显示瞬时失败后可重试，修改其他设置不重新打开暂时隐藏的桌宠。
- 待机趣味动作可设为关、低、普通、高，间隔分别约180–300、90–180、45–90秒；只在无活动任务且动态效果可用时触发。免打扰暂停自动问候、闲聊、趣味动作及自动休息，不停止Agent或阻断手动互动。喝水只是角色动画，不是独立健康提醒。手动轻拍、自动问候与随机挥手的来源分别处理。
- `CompanionVideo.tsx`在自动动作被任务或免打扰中断时释放旧视频，不等新片完成解码；迟到的`play()`结果不得重新显示旧片。媒体故障回退静图，后续动作或重新打开时允许重试，不永久拉黑失败片段。
- `ChatSidebar.tsx`复用既有会话批处理计划与后端保护，支持跨分组、按搜索结果多选归档、恢复及永久删除；归档/删除确认、运行任务保护、草稿落盘与失败逐项反馈保留。归档暂停关联定时任务，恢复不自动重启；批处理期间限制冲突导航和创建。
- 本轮重新处理全部36段动作，补充闭合红色背景区域与特定片段地面残影的保守清理；原始36份MP4只读保留。最终清单、浅深背景检查、构建及Electron实际结果见[1.3.5验证记录](docs/VALIDATION_1.3.5.md)新增节，不沿用第74节旧清单SHA或大小。

调研范围与迁移取舍见[开发调研记录](docs/COMPANION_RESEARCH_1.3.5.md)。本轮没有新增后台麦克风、屏幕采集、自动批准、隐式额度读取、桌面自动漫游、桌宠插件包、每日统计或养成系统；主界面已有审查、检查点和引导不等于桌宠新增这些操作。保持既有权限、用户数据路径、版本、应用图标与启动展示行为。

本轮第一阶段完整串行Vitest190文件、2506项通过，14项环境跳过；显式启用重试补丁后再次全量为189文件、2508项通过，1项失败、14项跳过（348.57秒）。失败为`guarded-workspace-io.test.ts`闲置回收用例收到守护进程退出，不是超时；单独用例、整文件13项和重复10次随后均通过，但缺少退出来源证据，未修改worker或放宽断言，不能声称该次全量通过或根因已经解决。最后构建、资源及桌面专项结果继续以验证页追加内容为准。

后续补齐桌宠导航的同步预检、最终领取、过期回执及并发顺序保护，未保存的消息编辑、项目记忆、跨目录文件编辑、生图及工作站草稿遵守离开保护。快捷Chat主进程切换先锁定Renderer，等待在途输入处理及草稿保存，再提交目标快照/归档状态后解锁；未保存历史编辑、保存失败及revision冲突保留原会话供处理。Chat跨组批处理期间暂停冲突输入与新建/导航，逐项失败可重试。最新完整串行Vitest为**196文件通过、3文件跳过，2,621项通过、14项环境跳过，0失败，345.05秒**，最终JSON为仓库`.impeccable/review/v135-companion-followup-final-vitest.json`，SHA-256=`29fd1443a06a476755b97c763d28e5a3eb93055e3a93760c07c8fac26e186900`；同名旧log仍属于190文件/2506项阶段，不要混用。历史守护进程退出根因没有因此被证明消除。

最终第33段仅对精确原片SHA启用下部ROI独立红幕碎点清理，保留完整8连通人物、低alpha桥、斜向连接及肤色/异色域。121帧编码前RGBA证明及编码后浅深背景预览见`.impeccable/review/companion-33-debris-fix-135/final/`；该证明不代表有损WebM像素不变。第33段为797,420字节、SHA=`5457bed21ae4a675cd819e5b9772cf4ef5968f14c21666a3cbe86fee3c30bbba`；其他35段输出及36原片SHA保留，36段最终合计32,760,385字节/4,404帧，manifest SHA=`11bf5abcb116e07a9920288e644469f72546e476d42bb1960ecfd7a0638bf557`。320px预览未见可辨鞋边碎点，放大仍可能有极低Alpha色晕、边缘残色或抠像损失；不宣称逐像素完美或无损。

最终媒体冻结后根脚本整套157项通过、0失败/跳过，29.75秒；Node/Web类型检查、Biome519文件、生产构建、3组桌面入口/36动作SHA与引用图、13,865项资源/生产依赖/1.3.5预检通过。主入口`index-Ca2GyCVz.js`/`index-Bg4OjqQj.css`、桌宠`companion-DAKnv3x9.js`/`companion-Dddzz5AG.css`，启动入口保持`startup-DiQLLh_R.js`/`startup-s2DYVeUi.css`。最终真实Electron专项结果仍按[验证记录](docs/VALIDATION_1.3.5.md)本轮后续条目，不把构建或静态预检当作桌面/正式NSIS安装升级验收。

工作会话与Chat批量管理的完整真实Electron专项随后退出0：32组、118截图、75组几何、36/36旧媒体解码各3时点，0异常、0 console error、0截图重试，结果为`.impeccable/review/v135-desktop-experience-1795338412733/result.json`。覆盖真实工作状态/耗时/标题脱敏、240×280小工作区、未保存消息/项目记忆拒绝跳转、延迟导航领取、真实待机与迟到播放保护、跨组批量归档/恢复/删除、第二页目录失败恢复、快捷Chat及主窗草稿revision冲突与删除后迟到保存。中间焦点前提、Electron夹具方法代理、错误选择器、合成有限动画采样及纯截图超时均如实记录在验证页；产品断言未放宽。纯截图可有一次受限重试，最终未触发；历史失败根因不因后续通过而确定。专项进程及临时profile已清理。该次产品回归发生在下述透明RGB扩散媒体更新之前，后续媒体须另行构建与解码，不混用资源证据。

最终36段再次接入6px透明RGB扩散以减轻VP9色度采样的红边回流，只更改去色后完全透明像素的RGB。4,404帧及385,716,795个非零Alpha像素的逐帧比较证明扩散前后Alpha及非透明RGBA不变；证明止于第21段缩放和有损编码之前，不能推成最终成品无损。第12段小样轮廓红色优势指标下降约30%至38%，但整体合成MSE略升；浅深接触表已逐张查看，高倍仍可能有细微暖边。最终36段为47,530,948字节/4,404帧，较前一版增加14,770,563字节（约45.1%媒体体积），36原片SHA保持不变。manifest SHA=`541f509ccc77128f9ee8edc47c8e926c4533e0ddb61ca9f2782e7ba33c279f13`；生成脚本SHA=`cd5f1ae86d243df3feb994737f115256ee8a3cfc103e85a536d38b0d98e3e9c0`、key脚本SHA=`b426f0041eca0dc185e11d53e58f5c4d93926122b408a4f2f261b6943633ae24`。证明和接触表见`.impeccable/review/companion-edge-alpha-audit-135/final-36-report.json`及同目录`final-36/`；不再复用上一段32,760,385字节或旧清单作为当前媒体结果。

这次媒体冻结后根脚本完整160项通过、0失败/跳过（23.56秒），生产构建、3组桌面入口/36媒体SHA引用图及13,865项资源/依赖/1.3.5预检均退出0；桌宠入口更新为`companion-DR-7HiLX.js`，主工作台和启动入口保持。新构建运行`desktop-experience-smoke.mjs --media-only`退出0：2组、38截图、2几何，36/36视频各3时点共108次采样，透明/可见非黑/帧变化断言全部通过，0异常、console error与截图重试。结果为`.impeccable/review/v135-desktop-experience-1795339351075/result.json`，SHA=`92e8222d0eedbeb1f46ecdaa2f39d961cce8f13b98be84755aff6b027ed12ddc`；当前smoke脚本SHA=`807090ad2bf80931d8e532e40450b54abb03e8fdcdf8660584a8b6c0740cf21f`。该媒体专项不冒充完整32组产品再测，应用逻辑仍使用上述2,621项及完整32组的对应证据。Node/Electron专项进程和临时profile均清理；相关文档入口经双语交叉核对，未生成正式安装包、安装、发布或推送，版本保持1.3.5。

## 76. 2026-11-22 / 1.3.5 本地插件故障、逐请求 Hook 与网页预算修复

版本保持1.3.5。用户导出的1.3.4日志包含12次 `SKILL_RESOURCE_NOT_FOUND`，根因是 Harness Plugin API 技能声明了缺失的按需参考资源；补齐清单、Hook、接口、Schema和开发流程参考，并让 `use_skill` 在资源缺失时列出可用相对路径。插件校验现在区分单插件目录和 `marketplace.json` 市场根，市场根逐项检查目录而不注册或安装。用户插件 `route-marker/hooks/hooks.json` 的日志显示 UTF-8/JSON 字符串未闭合，属于该插件源文件内容问题；本轮不改写用户工作区插件文件，校验会明确拒绝错误声明。

- `web_search`、`web_fetch` 的单次总请求预算调整为90秒，搜索备用来源共用同一截止时间；将用户取消、90秒超时及网页服务/网络错误分开反馈。此预算不覆盖模型请求或其他工具。日志中历史“operation was aborted”还包含较早版本的多个阶段及非搜索请求，不能把所有旧记录归因为同一20秒超时；90秒也不能修复DNS、断网、远端拒绝或协议不兼容。
- `BeforeModelRequest` 为prompt-only Hook，覆盖主 Code/Work 活跃运行的每次模型请求、后续轮次、网络重试及该运行触发的压缩/记忆请求。实际由活动父运行经 `runSubagent` 创建的子任务，初始读取父会话选择及派生时已激活插件，父运行之后按需激活的插件在该子任务下一次未发送请求前生效。状态位于独立prompt-only集合，不写入子任务运行激活/MCP集合；子任务不获得插件MCP、动作Hook、`UserPromptSubmit`、`Interrupt`、命令或 `local_plugin`。独立 `@` 子会话、Chat、安全审批、AutoDrive、草稿润色和运行后标题请求仍不在该Hook范围。
- 验证与运行共用 `plugin-prompt-declaration.ts`。`BeforeModelRequest` 的 `type:"prompt"` 若缺少非空字符串 `text`，目录校验直接报错；运行时遇到同类已安装插件坏声明时fail-closed，不发送该模型请求。command/MCP嵌套的prompt形状不会被误解析或执行。Hook声明读取失败、超时或超出单项/合计预算均在发送前失败。
- 市场更新每轮round-robin最多扫描10个市场、每个清单最多200条，按市场缓存候选并合并跨批结果；只替换本批市场结果，并复核市场身份、provenance、安装状态与版本以清理已移除、卸载、来源不符或已追平的候选。UI明确表示轮换下一批，不声称一次检查全部市场。无来源或来源不可追踪的直接导入插件不按同名自动认领；用户确认来源并点击更新后才安装，不会静默执行新版。
- 技能参考、SDK、创建器说明、中英文本地插件手册/更新日志及README已同步上述行为与隔离边界；README另修正了旧的750ms跳过说明，改为3秒总预算、请求发送前fail-closed，并记录实际派生子任务只继承提示文本。90秒请求反馈及市场轮换说明也同步到双语使用手册。版本、数据模式、协议修订号均不变。

本轮验证：7个受影响测试文件（插件校验/Hook/子Agent/市场轮询/网页/压缩）**161项通过、1项平台跳过**；聊天模型与压缩缓存的另4文件回归**214项通过**。根 Node 脚本套件**160项通过**；类型检查通过；Biome **522文件**通过；生产构建退出0（main 171模块/2,149.03kB，renderer 2,362模块）；桌面入口资源专项通过；`package-win.cmd --check`核对**13,871项资源**、生产依赖与1.3.5。隔离 Electron 插件 smoke 退出0：**27场景、89次模型请求、15张截图**；新增子Agent证据为父3次/子2次请求均含标记，子只读工具循环完成，未暴露插件MCP工具且Hook调用日志未变化。结果为`.impeccable/review/v133-local-plugins-1795351462798/result.json`，SHA-256=`e1490d265b8da7ed2a4376d69717b68eb2f85d6f2ae9a6bea21aa05e52b77a0f`；当前smoke脚本SHA-256=`9ff28a56c5fd6831fb3a1555a9424aae8c44599c79ff228087feab45d8691b79`。

本轮 `pnpm test` 的完整回归退出1：**191文件通过、6文件失败、3文件跳过；2,664项通过、7项失败、16项跳过**。全部7项失败均在 Windows 创建 junction/symlink 的夹具准备阶段返回 `EPERM`，没有抵达被测安全断言，分布于LSP、`local_plugin`、Terminal、guarded workspace IO（2项）、LocalReview及WorkspaceSearch；不放宽链接安全测试，也不将本次全量写为通过。`pnpm lint`、类型、根脚本、构建和打包预检通过；未生成正式NSIS/ZIP、未安装、未发布、未执行SQL或提交/推送。完整记录见[1.3.5验证记录](docs/VALIDATION_1.3.5.md)。

最终交接复核：README文案同步后，插件验证/Hook/市场/SubAgent/网页/压缩与模型流共9个Vitest文件**289项通过、1项平台条件跳过**；`node scripts/package-desktop-surfaces.cjs`通过（3个preload、3个HTML、36段47,530,948字节动作素材）；`package-win.cmd --check`通过（13,871项资源、生产依赖及1.3.5）；`git diff --check`退出0，只有既有LF/CRLF转换提示。README只改文档，无需重建生产入口。打包预检没有生成正式安装包；此前7项junction/symlink夹具`EPERM`仍是完整Vitest的真实环境失败。

## 78. 2026-11-22 / 1.3.5 生图配置复核与桌宠置顶补强

版本继续保持1.3.5。Image Studio已有的质量、自动/预设/自定义尺寸、比例、透明背景、1–10张生成与素材原图下载流程复核保持：共享schema校验请求，主进程检查供应商返回的Base64图片并按素材ID使用系统保存对话框导出。只接受兼容模型实际支持的参数，供应商拒绝时返回错误；本轮未增加模型能力猜测或静默降级。

- `companion-controller.ts`在Windows置顶且可见时每200ms重新应用topmost并调`moveTop()`，覆盖未产生`blur`等Electron窗口状态变化的可见遮挡。原生右键菜单打开期间暂不重提Z序；检测到隐藏/最小化后120ms尝试无焦点恢复。主动隐藏、关闭、禁用、取消置顶和退出仍取消相应恢复逻辑。
- 中英文用户手册、更新日志、README和1.3.5验证记录已同步。真实Win32 `Win+D`、`Win+M`、其他进程/原生浮层、UAC、独占全屏及不同Windows会话尚未实测；此逻辑不是Shell豁免或对所有系统窗口的保证。

本轮6个受影响Vitest文件**101项通过**；完整串行Vitest**198文件通过、3文件跳过，2,694项通过、15项跳过、0失败**。根Node脚本**160项通过**；`pnpm typecheck`、Biome **523文件**、`pnpm build`（main171模块/2,162.20kB，renderer2,362模块）、3组桌面入口/36段动作资源检查及`package-win.cmd --check`（13,871项资源、生产依赖和1.3.5）通过；`git diff --check`退出0，只有已有行尾提示。完整结果见[1.3.5验证记录](docs/VALIDATION_1.3.5.md)本节。未生成正式NSIS/ZIP、未安装或发布、未提交/推送；没有改变数据schema、协议修订号、用户路径、图标或版本。

## 77. 2026-11-22 / 1.3.5 生图工作台与桌宠置顶恢复

版本保持1.3.5。生图工作台当前完整请求设置包括质量、自动/预设/自定义宽高、比例、透明背景与1–10张输出；设置通过共享schema验证并存入工作区，再经主进程发送到OpenAI Images兼容`/images/generations`端点。供应商/模型不协商各参数支持矩阵，故不支持项依赖供应商错误明确反馈。返回图片要求Base64，拒绝远程URL并校验格式、尺寸、请求数量及合计字节后才写入素材。每项素材的下载只通过素材ID进入IPC，主进程先复核素材再打开系统保存对话框，不接受Renderer任意目标路径。

- `companion-controller.ts`的Windows置顶仍使用Electron `screen-saver`层级；失焦时重新申明置顶并调用`moveTop()`。置顶且未被用户主动隐藏时，以200ms单次递归定时器监视Electron报告的`isMinimized()/isVisible()`；检测到隐藏后等待300ms恢复，并优先通过`showInactive()`避免主动抢焦点。用户隐藏/关闭、禁用、取消置顶、替换窗口和退出都会清理恢复/看护定时器。该实现只在检测到的窗口状态上做应用级尽力恢复，不是对Win32 Shell的豁免，也未实机按`Win+D`验收；不能保证覆盖UAC安全桌面、独占全屏、不同Windows会话、系统级窗口或不暴露为hidden/minimized的cloaked状态。
- 中英文README/用户手册/更新日志同步下载、生成选项、供应商兼容边界和桌宠置顶行为；文档不把模拟事件测试写成真实Shell验收。未改变数据schema、协议修订号、用户数据目录、图标或版本。

本轮最终验证：Image Studio/Preload与桌宠控制器定向5个Vitest文件**89项通过**；完整串行Vitest `pnpm --filter @mingshen/desktop exec vitest run --maxWorkers=1 --no-file-parallelism`为**198文件通过、3文件跳过，2,692项通过、15项跳过、0失败**，282.50秒；新增桌宠看护测试通过，但模拟的是无Electron事件时的隐藏状态，不是实际`Win+D`。根Node脚本套件**160项通过、0失败/取消/跳过**；`pnpm typecheck`通过；Biome**523文件**通过；生产构建退出0（main171模块/2,161.74kB，renderer2,362模块）；`node scripts/package-desktop-surfaces.cjs`验证3组preload/HTML和36段动作通过；`package-win.cmd --check`验证**13,871项资源**、生产依赖及1.3.5通过；文档同步后`git diff --check`退出0，只有既有Windows行尾转换提示。未生成正式安装包、未安装、发布、提交或推送。

## 79. 2026-11-23 / 1.3.5 NSIS 欢迎页插件解析修复

用户正式打包已通过Electron准备、生产构建、13,871项源码资源/依赖预检及afterPack校验，但NSIS编译在自定义`installer.nsh`调用`${If} ${isUpdated}`时找不到`StdUtils::TestParameter`。本机`nsis-resources-3.4.1`缓存SHA-256与electron-builder内置校验值一致，Unicode插件目录内的`StdUtils.dll`存在；未清理或修改全局缓存、`node_modules`或上游工具。

欢迎页改用NSIS内置`FileFunc.nsh`解析`/updated`参数，在自定义include被读取时不再提前触发StdUtils插件调用；更新安装仍跳过欢迎页。用户重试后发现冗余且未引用的页面离开回调触发NSIS `warning 6010`并被electron-builder视为错误；已删除该回调，清理仍在`nsDialogs::Show`返回后执行。真实makensis隔离夹具现启用`/WX`并验证无警告，`node --test scripts/installer-visuals.test.cjs` **4项通过**；`node scripts/installer-visuals.cjs`通过；`package-win.cmd --check`通过（**13,871项资源**、生产依赖与1.3.5）。完整正式打包尚未再次运行，未确认NSIS/ZIP生成成功；版本1.3.5不变。详情见[1.3.5验证记录](docs/VALIDATION_1.3.5.md)新节。

## 80. 2026-11-23 / 1.3.5 NSIS 警告修复与正式包完成

后续重试发现两项新的NSIS严格警告：`warning 6040`来自electron-builder默认加入26种语言，而欢迎页自定义字符串只定义英语/简体中文；`warning 6001`来自仅给测试追帧使用、正式安装器未启用的`TraceFile`变量。`electron-builder.yml`现在将`nsis.installerLanguages`限定为`en_US`和`zh_CN`，保留双语选择并与LCID 1033/2052匹配；删除无产品用途的TraceFile变量和条件代码。测试及打包预检会断言安装语言配置，真实NSIS fixture以`/WX`编译并检查没有警告。`warning 6010`冗余离开回调已在第79节记录移除。

完整正式打包退出0：生产构建、13,871项资源/依赖预检、afterPack及NSIS安装器/卸载器生成通过；安装器保持未签名。实际发布目录`apps/desktop/release-artifacts/`包含1.3.5 x64 EXE、ZIP、ZIP SHA-256及JSON元数据。EXE大小379,004,650字节，文件及产品版本资源均为1.3.5，SHA-256=`e5bb860cb8358069d465f28fdc07b94720fe3150dca2ab12f34c8a21b938200`。ZIP大小378,071,417字节，SHA-256=`c7dec5c38ac1af95f737752bd44f82e0605b00fa0e8f736290665e971e9620e1`；`.sha256`文件和JSON中的SHA、大小、文件名、版本均与ZIP实测一致。

`node --test scripts/installer-visuals.test.cjs` **4/4通过**（严格NSIS编译无警告）；`node scripts/installer-visuals.cjs`通过；`package-win.cmd --check`通过（13,871项资源及1.3.5）；正式打包最终退出0。没有安装或运行新EXE，也没有改变版本、schema、协议修订号或用户数据；未提交/发布。

## 81. 2026-11-23 / 1.3.5 Release SQL

维护者提供1.3.5 GitHub ZIP直链并要求补入完整文件大小和SHA-256。新增[发布脚本](supabase/publish-release-1.3.5.sql)，使用 `public.mingshen_app_releases`、0003 ZIP字段和 `on conflict (version)` 幂等upsert；本地实测 ZIP 为378,071,417字节，SHA-256=`c7dec5c38ac1af95f737752bd44f82e0605b00fa0e8f736290665e971e9620e1`，与 sidecar/JSON一致。脚本公告符合notes 1000字符限制，链接使用维护者提供的 `V1.3.5/MingshenHarness-1.3.5-x64.zip` 直链。更新[Supabase说明](supabase/README.md)与[1.3.5发布说明](docs/RELEASE_1.3.5.md)。远端ZIP未下载，本轮未上传、执行云端SQL、提交或推送；维护者须在已部署0003的Supabase SQL Editor手动执行。

## 82. 2026-11-23 / 1.3.6 生图画布库版本与文档接续

本节保留文档准备阶段的历史状态；源码实装和最终验证已由第83节及[1.3.6验证记录](docs/VALIDATION_1.3.6.md)接续，不再适用下文“未执行”的阶段判断。

用户要求版本升级为1.3.6，并实现生图画布的新建、导入、重新打开、重命名、关闭及“我的画布”文件管理。本轮文档工作仅同步版本和交付边界，不改变1.3.5历史发布文案、验证数字、桌宠说明、正式包SHA-256、大小、GitHub直链或`publish-release-1.3.5.sql`。

- 根`package.json`、桌面`package.json`和`apps/desktop/src/shared/release.ts`统一为1.3.6；`package-win.cmd`、`run-experimental.cmd`和本地插件SDK说明同步显示1.3.6。`electron-builder.yml`和打包脚本继续从桌面`package.json`动态读取版本。
- README增加1.3.6生图画布库说明，并把当前Release、验证、预期EXE/ZIP和构建缓存路径指向1.3.6；1.3.5功能段落和桌面体验历史仍保留。
- 双语更新日志增加1.3.6开发中条目；双语使用手册说明独立画布工程、关闭与删除语义、“我的画布”操作、导入素材/画布区别和本地数据边界。三份协议只更新当前适用软件版本，生效日期和协议修订号`2026-11-04.3`保持不变。
- 新增[1.3.6发布草案](docs/RELEASE_1.3.6.md)、[1.3.6验证记录](docs/VALIDATION_1.3.6.md)和[生图画布库调研](docs/IMAGE_STUDIO_RESEARCH_1.3.6.md)。发布草案明确尚未生成正式包、ZIP元数据或发布SQL；验证记录把定向测试、类型、Lint、完整测试、构建、资源预检、Electron smoke及正式安装包全部标为未执行。
- 画布库最终架构目标仍是独立本地JSON工程加共享不可变素材：关闭标签只移出打开列表，删除工程必须显式执行；复制画布生成新画布和图层ID但复用素材；保存、重命名、复制和删除串行化；Renderer只传合法画布ID。旧SQLite工作区应幂等迁移并保留原值备份。该目标不代表当前源码、IPC、preload、UI、迁移和测试已经完成。

本轮只修改版本与文档，没有完成代码实现或应用验证。11个预检要求的文档版本头通过；`pnpm package:check`通过，核对13871项资源、生产依赖闭包和版本1.3.6。`pnpm typecheck`、`pnpm lint`、Vitest、生产构建、`package-win.cmd --check`入口复核、Electron smoke、正式NSIS/ZIP、安装/升级/卸载均未执行；资源预检不等于源码、构建或安装器验收。没有创建`publish-release-1.3.6.sql`，没有修改或执行1.3.5发布事实，也没有提交或推送。任何后续完成状态必须追加到[1.3.6验证记录](docs/VALIDATION_1.3.6.md)，不得复用1.3.5结果。

## 83. 2026-11-23 / 1.3.6 本地画布实装、测试启动与尺寸警告

版本保持1.3.6。本地画布库已接通主进程、IPC、preload、Renderer和迁移，工程保存在`%userData%/image-studio/canvases/<canvasId>.mingcanvas.json`，共享素材不重复复制。顶部和“我的画布”支持新建、导入、重命名、关闭、搜索、重开、复制、删除和定位；关闭不删除文件，删除工程不级联删除共享图片。旧SQLite工作区保留迁移备份，损坏工程显示错误；仍保存完整工作区，保留2 MiB、40张同时打开画布和200项素材上限，不宣称改成纯文件索引或无限容量。

- 保存与文件操作统一串行，临时文件同步后同目录替换，跨文件/SQLite失败有补偿而非严格事务。删除素材检查关闭工程引用，素材并集超限拒绝而非丢图层。缺失工程用`CanvasProjectNotFoundError`区分，缺失素材不会当作新工程覆盖旧稿。
- `CanvasRecoveryError`使内部部分写入回滚失败和数据库提交后补偿失败统一保留本轮新素材，提示可能需要人工恢复；回滚成功仍清理新素材。服务测试覆盖第二工程保存失败且第一工程回滚也失败的路径。
- `ImageStudio`在关闭、删除、复制和重命名时设置`inert` / `aria-busy`，防止迟到编辑与保存把关闭标签重新打开。真实smoke通过挂起关闭IPC验证该状态后释放继续。
- 用户截图停在协议页的根因是smoke的CDP选择了首个page，实际是约5秒后销毁的`startup.html`；现主进程只选`node`，Renderer只选`/renderer/index.html`，不再连接启动页。测试使用独立临时profile按正常UI勾选三项协议、等待阅读并完成手册，不给正常产品增加自动同意或绕过。
- 有效图片返回尺寸与请求不同时，`warnings`携带逐张`size_mismatch`及请求/实际尺寸，图片按真实解码宽高保存并可加入画布；界面持久显示可关闭警告。真实2,880×2,880 PNG对应3,840×3,840请求已测试落盘。自动尺寸或相同尺寸不警告；Base64、完整解码、格式、数量、字节、透明格式和远程URL拒绝规则不变。

业务源码冻结后完整串行Vitest退出0：**198文件通过、3文件跳过，2,710项通过、15项跳过、0失败**，335.01秒；JSON为`.impeccable/review/v136-vitest-final.json`。Image Studio/shared/队列/preload定向4文件50项通过，服务其中25项；根Node脚本18文件160项通过、0失败/跳过。类型检查、Biome523文件、生产构建、3个preload/3个HTML/36段47,530,948字节动作专项、13,871项资源/生产依赖/1.3.6预检及`package-win.cmd --check`均退出0。

隔离真实Electron smoke退出0：**20组场景、55张截图、466组几何、6次本地合成供应商请求，0运行异常、0服务夹具错误**；结果`.impeccable/review/v136-creative-image-1795417479606/result.json`。覆盖首次协议接续、780模板与交接、润色/反推/生成/尺寸警告、指针编辑、PNG/GIF解码、工程导入导出、画布生命周期及两种风格/语言/日夜/1440/800/680布局。截图是脚本产出，不宣称逐张人工查看。中间隐藏设置栏和素材排序引起的夹具失败及其修正如实记录到验证页；最终完整流程重新通过。

文档同步README、双语手册/日志、Release草案和验证记录；1.3.5历史包、SQL、SHA和大小不改。本地同用户链接替换TOCTOU、删除后孤立素材及异常元数据规范化仍有边界，不宣称全部消除。未使用正常用户profile或付费供应商，未验证真实磁盘满/断电/杀毒竞争，未生成或安装1.3.6正式NSIS/ZIP，未执行发布SQL、Git提交或推送。详细命令、构建入口和限制见[1.3.6验证记录](docs/VALIDATION_1.3.6.md)。

## 84. 2026-11-23 / 1.3.6 BeforeModelRequest 可配置前后注入

版本保持1.3.6。每个本地插件 `BeforeModelRequest` 的 `type: "prompt"` 声明现在可独立设置 `position: "before" | "after"` 与 `format: "context" | "plain"`；省略时兼容旧行为 `before + context`。`plain` 不附加插件名、ID、来源或 `<mingshen_plugin_context>` 包装；`after + plain` 可把 `123abc` 直接放在本轮 `xxxx` 请求原文之后。这里的前后位置指发往模型的当前请求，不是模型响应。`context` 仍带低优先级、不可信的插件上下文标签，`plain` 是普通用户优先级文本；两者均不提高权限，也不保证模型遵从。

- 每次活动主 Code/Work 运行模型请求重新收集声明，包含重试、工具循环、运行关联的压缩/记忆请求，以及活动父运行经 `runSubagent` 派生子任务的首个和后续请求。注入只存在于请求载荷，不写回对话历史或下一轮；按需激活从下一次未发送的请求开始。
- 四种组合保持相互独立。普通用户轮次中按声明位置装饰本轮输入；在 Anthropic/Gemini 等工具结果轮次中，按协议把用户文本放在完整工具结果内容之后，不把它插到 tool call / tool result 配对之间，也不拆分工具结果和随附附件。`after` 的注入不会伪装为新的用户响应或改变已发送请求。
- 中英文 README、用户指南、更新日志、Release 草案、本地插件接口说明、SDK 与插件创建技能均已同步字段、示例、默认值、预算/失败语义和信任边界。普通插件作者可在单条 `type: "prompt"` 上组合两个字段，不需专用运行时接口或工具调用。

验证结果：最新串行 Vitest JSON `.impeccable/review/v136-hook-vitest-final-2.json` 包含203个测试文件结果，**2,765项通过、15项跳过、0失败**。定向 Hook/Provider/压缩回归共10个文件、361项通过；另有31项请求组合专测通过。根 Node 脚本套件160项通过；`pnpm typecheck`、Biome 525文件、`pnpm build`、`pnpm package:check` 和 `package-win.cmd --check` 均通过，后者核对13,871项资源、生产依赖和1.3.6。

隔离 Electron 插件 smoke `.impeccable/review/v133-local-plugins-1795422054492/result.json` 退出0：27项场景断言、91次本地合成模型请求、15张截图。四种组合在一次网络失败重试及父/子 Agent 请求中均被验证；运行证据为父3次、子2次请求包含注入，子任务只读工具循环完成，插件 MCP 工具未暴露给子任务且 MCP 动作日志未变化。测试使用临时 profile、本地合成模型和临时插件，不使用真实 Key、付费服务、用户数据库或正式安装包。截图为自动化产物，不声称逐张人工审阅。

`git diff --check` 在文档更新后通过。测试只证明请求负载和集成路径，不证明真实供应商对所有网关的兼容，也不保证模型会服从普通文本。ChatAgent、独立 `@` 子会话、审批安全审查、独立 AutoDrive/草稿润色和任务完成后的标题请求仍不触发此 Hook；插件提示文本仍受既有 3 秒/单条4,000/聚合12,000字符限制，Hook读取失败、超时或超限时当前请求 fail-closed。没有生成或安装1.3.6正式NSIS/ZIP，未执行发布 SQL、提交或推送。

## 85. 2026-11-23 / 1.3.6 Hook 顺序与可复用归属选项收口

在上一节的四种组合基础上，修正了连续运行中引导消息下的跨协议顺序：Responses、Chat Completions、Anthropic Messages 和 Gemini GenerateContent 都从原始消息序列定位尾部连续 user 消息的起点，将 `before/plain` 放在第一条引导及其附件之前；`after` 仍附加在最后一条引导之后。工具调用、工具结果、工具图片及其 ID/配对不被拆开或重排。没有尾部 user 消息时继续使用协议合法的普通 user 尾消息回退路径。

`format: "plain"` 作为不带插件归属的可复用选项，与 `position: "before" | "after"` 独立组合；不会发送插件 ID、标题、来源或 `<mingshen_plugin_context>` 包装。`format: "context"` 继续使用低优先级、不可信上下文包装。实际纯文本拼接为单个换行（`xxxx\n123abc`），README、双语手册、Local Plugins、SDK、Harness Plugin API 和 Plugin Creator 文档已统一该示例。

本轮新增连续引导/工具图片回归后，Hook/Provider/压缩相邻定向测试 **287 项通过**，`pnpm --filter @mingshen/desktop typecheck`、Biome 相关文件、`pnpm package:check`（13,871 项资源、生产依赖和1.3.6）以及 `node --check scripts/local-plugin-smoke.mjs` 均通过。完整历史测试数字仍以第84节冻结记录为基线；尚未生成或安装正式1.3.6 NSIS/ZIP。

最终回归随后完成：Vitest 203 个测试文件结果，200 通过、3 跳过；**2,767 项通过、15 项跳过、0 失败**，358.94 秒，退出 0。同次 `package:check` 退出 0，核对 13,871 项资源和版本 1.3.6。本节只追加本次结果，不覆盖第84节及上文的 2,765 历史基线；新的持久 JSON 路径尚待确认。

## 86. 2026-11-23 / 1.3.6 正式 Windows 包生成

用户要求生成 1.3.6 安装包后，在仓库根目录运行 `.\package-win.cmd`，退出码为0。Windows x64 Electron运行时准备、生产构建、13,871项资源与生产依赖预检、afterPack校验、NSIS安装器及更新ZIP均成功；安装器按项目配置未签名。验证记录及发布草案已更新，原有1.3.6源码验证结果不变。

`apps/desktop/release-artifacts/` 的实际产物：

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `MingshenHarness-1.3.6-x64.exe` | 379,034,508 | `0f767921cde4cbb826eaa74b7a7a8a679e7051947570be8873db72e096317906` |
| `MingshenHarness-1.3.6-x64.zip` | 378,102,275 | `b989ad93ca44a5438d2d524064d7e0b78981fe9a6fd60ba0c7247eba98163a7b` |

另有393,070字节的EXE blockmap、96字节ZIP SHA sidecar及216字节JSON元数据。独立检查确认EXE的FileVersion/ProductVersion均为1.3.6；ZIP仅含根条目`MingshenHarness-1.3.6-x64.exe`，条目大小和SHA-256与发布目录中的EXE一致，ZIP sidecar和JSON中的字节数/SHA与ZIP实测一致。

未运行安装器，安装、升级、卸载未验收；未提供公开ZIP直链，故未生成Release SQL、未上传或发布、未执行云SQL、未提交或推送。后续发版时须使用维护者提供的真实直链，并以实际部署schema为准生成发布SQL。

## 87. 2026-11-23 / 1.3.6 文档冻结后的最终安装包

参考图、拖放导入和后台生图最终源码已完成全量回归。随后更新 README、双语使用手册/更新日志、Release 草案、验证记录及本交接总览；`electron-builder.yml` 会把 `docs/*.md` 随安装器分发，因此随包文档不直接嵌入本次包的精确 SHA/大小，避免文件哈希自引用和文档变更造成旧校验值。精确包数据以旁置 `.sha256`、`.json` 和本节实测记录为准。文档冻结后于仓库根目录运行 ` .\package-win.cmd --check` 与 ` .\package-win.cmd`，均退出0；生产构建、Electron/Windows原生运行时准备、13,871项资源/生产依赖预检、afterPack 检查、NSIS 与更新 ZIP 均成功。

`apps/desktop/release-artifacts/` 本次实测产物：

| 文件 | 字节数 | SHA-256 / 检查 |
| --- | ---: | --- |
| `MingshenHarness-1.3.6-x64.exe` | 379,043,314 | `2174b31a5ae14428c61e47f5f8bb278663bd4576b2b9122e191e7a38c137ebdc` |
| `MingshenHarness-1.3.6-x64.zip` | 378,110,650 | `d67e7e4da1a88ae8b55c0be131627876dd240635ac5db642cbd9997aca3792f8` |
| `MingshenHarness-1.3.6-x64.exe.blockmap` | 393,109 | electron-builder 产物 |
| `MingshenHarness-1.3.6-x64.zip.sha256` | 96 | ZIP SHA 与实测一致 |
| `MingshenHarness-1.3.6-x64.zip.json` | 216 | 版本、文件名、字节数、SHA 与实测一致 |

独立复核确认 EXE 的 `FileVersion` 和 `ProductVersion` 均为 `1.3.6`。ZIP 仅含根条目 `MingshenHarness-1.3.6-x64.exe`；条目大小为379,043,314字节、条目 SHA-256 与外部 EXE 完全一致。ZIP 文件 SHA-256 与 sidecar、JSON 完全一致。当前安装器未签名，符合现有仓库配置。完整串行 Vitest 最终结果为204个测试文件、201通过/3环境跳过、2,787项通过/15项跳过/0失败，报告 `.impeccable/review/v136-final-background-vitest.json`；根 Node 脚本160项通过，类型检查、Biome 527文件、生产构建、创作工作台25组隔离 Electron smoke、`git diff --check` 和打包预检通过。

尚未运行安装器，安装、升级、卸载未验收；无公开ZIP直链，因此未发布、未生成发布SQL、未执行云端SQL、未提交或推送。

## 88. 2026-11-24 / 1.3.6 生图素材批量管理与安装布局优化

版本保持1.3.6。Image Studio 素材栏现支持全选当前搜索结果、清空选择、批量加入当前画布、合并导出 ZIP 及确认后批量删除；最多选择200项，ZIP 图片合计上限100 MiB，ZIP不携带提示词sidecar。删除先检查所有画布引用，任一图片仍被打开或保存的工程引用则整批取消；SQLite savepoint 同步移除工作区素材和旧迁移备份内对应的生成提示词、选中ID及图层引用，不改当前正负提示词。

迁移备份缺失时现在只在加载工作区成功后补建，不会在之后的素材操作中突然写入。画布删除时若进程在移入`.trash`后、SQLite提交前中断，启动清理会依当前工作区的画布ID恢复较新的工程文件；目标锁定、损坏或不安全时中止加载并保留回收文件，不会用旧快照覆盖。服务测试覆盖备份时序、正常恢复与恢复失败。

Windows打包把内置`resources/prompts/**`放入`app.asar`，将需逐个安装复制的提示词/Skill来源文件减少一万三千余项。需要文件路径的LSP、沙箱和Plugin SDK仍外置；保留默认NSIS 7z暂存解压与文件复制重试。打包后校验从ASAR回读提示词目录，逐项比对文件清单与SHA-256。此布局减少独立小文件复制工作，但未测得用户设备的实际耗时，不能承诺固定安装分钟数。

验证：全量串行Vitest 205文件（202通过、3环境跳过）、2,826项通过、15项跳过、0失败，JSON`.impeccable/review/v136-batch-final.json`；根Node脚本163项通过；`pnpm typecheck`、Biome529文件、生产构建（main172模块/preload3/renderer2363模块）、桌面入口资源检查、`pnpm package:check`及`package-win.cmd --check`的13,871项/版本1.3.6分别通过。批量素材 Electron smoke 28场景通过（见验证页）；主进程生图服务52/52通过。文档更新完成后重新生成并核验新版NSIS/ZIP，精确元数据见第89节。安装、升级、卸载未验收。未提交、未发布、未执行云SQL。

## 89. 2026-11-24 / 1.3.6 批量素材与安装布局最终包

本节记录文档冻结后的最终安装包，覆盖第82至88节中更早的1.3.6包产物和待完成状态，不覆盖源码验证历史。素材栏批量选择、ZIP导出、批量加入画布及批量删除已完成；提示词与素材记录/旧工作区备份同步清理，但当前正负提示词不变。无法清理已从素材记录移除的图片文件时，服务返回警告，磁盘可能留下孤立文件。安装优化将提示词/Skill资源树放入`app.asar`，保留默认NSIS 7z暂存和复制重试；没有启用ZIP直解。实际用户机器安装耗时尚未测量。

文档冻结后，仓库根目录执行` .\package-win.cmd --check`及` .\package-win.cmd`，均退出0。资源预检核对13,871项、生产依赖闭包与版本1.3.6；生产构建、afterPack从ASAR回读并逐项SHA校验、NSIS安装器及更新ZIP成功生成。NSIS按仓库设置未签名，提示没有代码签名证书属于当前预期配置。正式包位于`apps/desktop/release-artifacts/`：

| 文件 | 字节数 | SHA-256 / 校验 |
| --- | ---: | --- |
| `MingshenHarness-1.3.6-x64.exe` | 374,174,841 | `e8d67d28ddede3c4ebb57541ea9cd70f88140b2832209f91cc443e416cb6514b` |
| `MingshenHarness-1.3.6-x64.zip` | 374,131,585 | `5b9308933798260015944e8ad5302f2ca902191f076ac5c2efd2c387cffa8217` |
| `MingshenHarness-1.3.6-x64.exe.blockmap` | 389,171 | electron-builder产物 |
| `MingshenHarness-1.3.6-x64.zip.sha256` | 96 | 与ZIP独立SHA-256一致 |
| `MingshenHarness-1.3.6-x64.zip.json` | 216 | 版本、文件名、大小、SHA与实测一致 |

独立核对确认EXE的FileVersion/ProductVersion均为1.3.6。ZIP仅含一个根条目`MingshenHarness-1.3.6-x64.exe`，条目大小374,174,841字节，条目SHA-256与外部EXE完全一致；ZIP `.sha256`与JSON均匹配实测SHA和374,131,585字节大小。最新版源码最终串行Vitest结果为205文件（202通过、3环境跳过）、2,826项通过、15项跳过、0失败；主进程生图服务52/52通过；Electron smoke 28场景、55截图、466几何、10次本地合成请求、0异常和0服务错误；类型检查、Biome 529文件、生产构建、根Node脚本163项、打包预检和`git diff --check`通过，详见[1.3.6验证记录](docs/VALIDATION_1.3.6.md)。

未运行安装器，安装、升级、卸载未验收；没有公开ZIP直链，未生成/执行发布SQL、未上传发布、未提交或推送。先前1.3.6包SHA与大小只作历史留档，不应用于此次交付。

## 90. 2026-11-24 / 1.3.6 图片预算与最终发布包

导入与导出采用独立预算：PNG/JPEG/WebP/GIF手动导入或拖放每张最多25 MiB、每批最多20张、合计500 MiB；批量ZIP导出最多200项，源图片合计500 MiB。导出以请求ID隔离IPC进度，显示素材计数和累计字节；拒绝超限请求，不创建临时ZIP。图片生成响应仍保留独立100 MiB上限。文档已冻结后打包，所以随包的`docs/*.md`不含本包自己的SHA/大小。

最终检查：完整串行Vitest退出0，205个文件结果，202通过、3环境跳过，2,827项通过、15项跳过、0失败，395.38秒；JSON`.impeccable/review/v136-import-export-500mib-vitest-final.json`。预算/导出服务定向测试88/88通过；根Node脚本18文件163/163通过，29.52秒；`pnpm typecheck`退出0；`pnpm lint`的Biome529文件通过；`package-win.cmd --check`核对13,871项资源、生产依赖闭包和版本1.3.6通过。正式`package-win.cmd`退出0，生产构建、afterPack从ASAR回读提示词资源并逐项SHA校验、NSIS及更新ZIP生成成功。

完整创作/生图Electron smoke两次没有全绿：批量ZIP功能段本身在两次执行中均通过，核对了进度条、五阶段IPC顺序、字节值、ZIP中的PNG与所选源图SHA。其后第一次在`.impeccable/review/v136-creative-image-1795509233106/failure.json`等待布局用缩略图`img.complete`超时（脚本第693行）；第二次在`.impeccable/review/v136-creative-image-1795509498218/failure.json`等待画布PNG下载捕获超时（第1608行）。结果没有Renderer异常或服务夹具错误，但尚未确认这些等待失败是否纯属测试同步问题；不得将整套Electron smoke写作通过。未分配真实500 MiB图片，也未测试磁盘耗尽、杀毒软件锁定或真实供应商。

文档冻结后在仓库根目录执行` .\package-win.cmd --check`和` .\package-win.cmd`，均退出0；Windows x64 NSIS按现有配置未签名。`apps/desktop/release-artifacts/`中本轮实测最终产物：

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `MingshenHarness-1.3.6-x64.exe` | 374,179,291 | `e29f51595a0be6725752649adbd41aebed27c1f0802a7496a0b77b1951501b70` |
| `MingshenHarness-1.3.6-x64.zip` | 374,137,004 | `c9c4b120115e2f66510e9201bf9cfac4a341b667d4e5a9cec98176066254d130` |
| `MingshenHarness-1.3.6-x64.exe.blockmap` | 389,350 | electron-builder产物 |
| `MingshenHarness-1.3.6-x64.zip.sha256` | 96 | 与实测ZIP SHA一致 |
| `MingshenHarness-1.3.6-x64.zip.json` | 216 | 版本、文件名、字节数、SHA与实测一致 |

独立PowerShell检查确认EXE的FileVersion/ProductVersion均为1.3.6；ZIP只含根条目`MingshenHarness-1.3.6-x64.exe`，ZIP内EXE的大小与SHA和外置EXE完全一致；ZIP `.sha256`及JSON的版本、文件名、字节数、SHA均与实测相符。发布SQL为`supabase/publish-release-1.3.6.sql`，使用上述ZIP SHA和374,137,004字节；直链使用合法HTTPS示例占位符`https://example.invalid/REPLACE_WITH_PUBLIC_HTTPS_ZIP_URL`，必须替换成真实公开GitHub Release直链后才可执行。没有安装/验收安装、升级、卸载；没有执行云端SQL、上传或发布；未提交或推送。
