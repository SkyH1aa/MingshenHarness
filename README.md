<p align="center">
  <img src="apps/desktop/build/icon.png" width="88" height="88" alt="Mingshen Harness 原子图标" />
</p>

# Mingshen Harness

**Windows 本地优先的 AI 编程、办公与对话 Agent。**

连接自己的模型供应商，把编程任务、Office 交付、普通对话、工具执行和并行 Agent 放在同一个桌面工作台中。会话与项目记忆保存在本机，模型和扩展服务由你选择。

**版本 1.3.4** · **Windows 10/11 x64** · **简体中文 / English**

[版本亮点](#134-工作站与可靠性) · [快速开始](#快速开始) · [Agent 模式](#agent-模式) · [技能与插件](#技能与本地插件) · [开发与构建](#开发与构建) · [文档](#文档)

由新哲文院算法社维护，发布者 Ming。

## 功能概览

| 能力 | 支持内容 |
| --- | --- |
| Agent 模式 | CodeAgent / WorkAgent / ChatAgent 主界面切换；前两者共享会话与工作目录，ChatAgent 使用独立对话页、会话级联网开关，不接触本地工作区 |
| 自选模型 | Messages、Responses、Chat Completions、Gemini 原生四种协议；多供应商、多 Key、模型星标与供应商排序 |
| 并行任务 | 内置专业角色与协同总控、自建角色、只读 Plan、子 Agent 模型配置、后台委派、任务树、QA 状态与实时事件 |
| 创作工作站 | 780 个内置场景，每项均有简略和详细模板；分类、格式及多关键词检索，完整提示词预览、技能推荐、分节编辑及 WorkAgent 草稿交接 |
| 生图工作台 | 独立图片/语言模型、提示词润色确认与反推、本地素材库、可编辑无限画布、工程导入导出及 GIF 帧合成 |
| 连续任务 | 运行中发送文字引导，在下一次模型请求接入；另有最多 10 条下一轮消息，支持预编辑与附件，正常完成后按顺序自动发送 |
| 代码工作台 | 文件编辑与四范围 diff、行级审阅评论、本地代码索引、LSP、Formatter、Git 撤销恢复、快照与 worktree；多标签交互式 Shell |
| 长对话 | 上下文自动压缩、主备压缩模型、Token Saver、CTX 用量与供应商缓存诊断 |
| 文档与公式 | Office/PDF 读取、离线中英文 OCR、DOCX/XLSX/PPTX/PDF 制作、Word/PPT 旧稿受控编辑、精细排版、模板、图表与 Word 原生公式 |
| 项目记忆 | 按工作区选择原生 Memory 或 TencentDB 本地核心，管理偏好、任务日记与模型提取的语义记忆 |
| 工具与扩展 | 文件/命令/图片工具、内嵌 Chromium、Skills/插件自动发现与按需加载、原生本地插件开发/校验/安装/更新、stdio/HTTP MCP、GitHub 集成与可选本地 API/SDK |
| 日常使用 | 项目图标栏与分支/worktree 会话视图、统一命令搜索、草稿润色、临时指令、项目语气、批量归档、双界面、托盘与原生通知 |

### 1.3.4 工作站与可靠性

- **Mingshen 工作站**：内置 780 个独立工作场景，覆盖 65 种任务结构、12 个分类。每项均提供保留原有方式的简略版和详细版；默认中文详细提示词不少于 800 汉字，由场景专属内容与同类共享的专业流程、执行规则组成，编辑后长度可能变化，字数不等于质量验收。详细版写明资料、专业方法、版式、场景风险、验收及真实推荐技能。支持分类、交付格式与多关键词组合搜索、全文预览和复制；切换版本保留已编辑内容，草稿可撤销、保存及导入导出。模板涵盖文档、演示、表格、财务、人力、采购、销售、协作与教学，Office 协作产品按当前支持的文件或交接规格交付。实际文件由 WorkAgent 按需制作，详见[模板说明](docs/WORKSTATION_TEMPLATES.md)。
- **内置技能与侧栏**：同源、同路径技能的多个版本按语义版本只显示最新版，独立来源及用途变体继续保留；旧选择和权限规则兼容。修复 Code/Work 侧栏因行布局错位产生的大块空白，空项目与长列表均按内容分配空间。
- **生图工作台**：分别选择图片模型和语言模型，先预览并确认润色提示词再生成；支持本地素材、视觉模型反推、画布图层编辑、工程导入导出与 GIF 合成。当前生图接入 OpenAI Images 兼容接口并要求返回 Base64 图片；GIF 由已选图片帧组成。
- **AutoDrive 与角色协作**：点击自动规划下一步，由当前模型只读结合历史、计划和仓库证据提出至少三个不同方案，选择后加入草稿。worktree 模式只读取已建立的实际目录；尚未建立时提示先在该会话运行任务。协同总控可拆解工作包、点将并行执行、汇总结果，并通过独立 QA 记录真实质量状态。
- **项目开发工作面**：`Ctrl+Shift+P` 同时搜索文件、命令和历史会话；项目支持分支/worktree 分组和未读状态。右侧新增真实 Shell 多标签终端；本地审阅可按 Git、Branch、会话和上一轮切换，选择代码行写评论后送入输入框。
- **草稿辅助**：支持一键润色并预览确认，可在设置中指定润色模型；下一轮临时指令随该次发送或队列项使用，项目语气按工作目录保存。
- **运行中引导**：主 Code/Work/Chat 和快捷 Chat 可发送补充文字，当前回复和工具批次继续执行，在下一次模型请求接入。界面显示等待接入、已接入或未应用；“加入下一轮”仍用于当前任务结束后的独立任务。

- **DeepSeek 工具链续接**：修复 thinking 开启时，受控工具链中合成步骤缺少供应商续接状态而触发 HTTP 400 的问题。
- **原生 Memory 摘要**：修复 512 token 输出预算被推理内容耗尽后无法保存任务摘要的问题，并保留取消、超时及不写入半截摘要的边界。
- **原生沙箱终止**：为停止失败或子进程未关闭增加有界结算；清理结果无法确认时继续保留写入屏障，不降级到宿主执行。
- **会话目录同步**：修复增量同步跳过的未知会话在 revision 推进后无法恢复的问题，并覆盖新建、删除和升入可见范围的目录变更。
- **恢复路径竞态**：收紧宿主快照及 Git 恢复路径在检查与 I/O 之间的重解析窗口，以句柄级检查拒绝 junction、reparse point 和 NTFS 硬链接，并在临时文件 Flush/SHA 校验后通过受保护句柄提交，失败时恢复旧内容或保留明确备份；静态链接拒绝和用户主动恢复语义保持不变。
- **缓存与命令清理**：移除工具结果去重产生但无人读取的缓存条目；持久命令后续清理成功时清除旧错误并释放名额，未确认时保留命令记录、写入屏障和租约。Native Sandbox 的未确认清理另保留 typed tombstone。退出时所有服务也会完成结算后才关闭数据库。
- **对话与附件**：Chat Completions 的 `[DONE]` 不再单独视为成功，必须收到正式非空 `finish_reason`。每条消息最多 10 个附件、单文件 25 MiB、合计 50 MiB，并在读取文件字节和 IPC 前预检。
- **ChatAgent 联网控制**：输入区可按会话切换“允许联网 / 禁止联网”。允许时只开放 `web_search`、`web_fetch`，不再逐次弹出联网审批；禁止时工具从模型列表中隐藏，主进程仍拒绝伪造调用。此开关不阻断所选模型供应商连接，也不改变附件提交行为；基于原对话新建或分支时保留其禁网状态。
- **项目与执行边界**：OpenCode/Mingshen 项目 JSON 与项目 Markdown Agent 只在项目已信任后加载，项目 `{file:...}` 指令引用不能越出工作区；项目 `build` 创建独立 Profile，不覆盖内置 `primary`，撤信任会清理项目来源。LSP 查询同样限定当前工作区。全访问宿主命令取消或进程树清理失败时有界结算并保留未确认屏障；启动初始化失败会在有界清理后退出，不继续持有单实例锁。
- **文档与集成防护**：Office 解析进入有界 worker，ZIP 路径、条目、解压总量和 XML 主动声明有硬限制；Excel 请求有累计工作量预算，危险公式和外部引用被拒绝，嵌入工作簿限制递归深度、数量与累计解压量。宿主文档覆盖使用受控提交与失败恢复：锁定旧目标、备份、提交、回读核对，并在失败时恢复旧内容或保留明确备份；Windows 分步重命名之间仍有极短 gap，不宣称断电级无间隙原子覆盖。MCP OAuth 请求拒绝重定向，编辑密钥时保留未改值；ACP 处理失败/中断，并有界处理取消请求，abort 失败或超时会清理本地 waiter 并报告远端停止未确认；本地浏览器预览使用会话授权令牌；无头 API 复用正常会话校验。实验入口每次先构建当前源码；插件市场清单使用同进程队列、跨进程锁、随机临时文件及原子替换，正常写入最多等待 15 秒。锁超过 60 秒时不按 mtime 自动删除，会保留原清单并报告锁路径，要求确认无 writer 后仅人工删除锁文件。

### 1.3.3 新增

- **Code / Work / Chat 三模式**：主界面直接切换工作方式。CodeAgent 与 WorkAgent 共用会话、工作目录和历史；ChatAgent 使用独立分组对话页，支持联网及主动上传附件的只读问答。
- **WorkAgent 办公交付**：新增结构化 Excel 创建与编辑、PPTX 旧稿受控修改、DOCX 无占位符局部编辑及精细排版，配套设计预设、商务版式和可选 Office 重算与渲染检查。
- **CodeAgent 工程闭环**：按需加载工程技能与参考，连续相同失败后要求更换策略，支持大工具输出分页恢复、受控文件检查点及测试、Lint、类型检查验证。
- **Work 专属技能资源**：内置 PPT Master、ASD-STE100 适配入口，保留 `WorkAgentSkill/` 全部 124 个物理来源；自动发现和手动引用展示 98 个活动来源，同源只显示最新版，PDF 的独立用途继续保留，正文按需加载。
- **本地插件开发市场**：支持创建、校验、手动安装、启停和更新 Harness 插件，内置 SkillCreator、PluginCreator 与 Harness 接口适配技能。Skills 和插件同时支持自动发现及会话内手动引用。
- **十条自动消息队列**：运行中可预编辑并加入最多 10 条后续消息及附件。上一任务正常完成后，按加入先后自动发送下一条；停止、失败或重启后保留并暂停队列。
- **后台 SubAgent 协作**：移除固定 10 分钟总运行期限，主 Agent 派发后可继续独立工作，再收集子任务结果；单次请求超时、并发上限和取消规则仍生效。
- **光轨工作台升级**：统一布局、信息密度、焦点态与状态动效；任务区可调整高度或收起，Work 提供办公起始草稿，并加强未保存计划保护。修复顶部警示图标撑高和输入时自行跳转格式预览的问题。
- **快捷 Chat 与自定义快捷键**：默认 `Ctrl+M` 打开或收起聊天小窗，`Ctrl+Alt+L` 切换主界面与托盘。支持小窗持久置顶、10 分钟会话续期，以及设置中的多修饰键录制和占用检测。

发布文案见 [1.3.4 Release](docs/RELEASE_1.3.4.md)，完整变更见[更新日志](docs/CHANGELOG.md)。Code / Work / Chat 三模式、Office 交付、本地插件、Work 专属技能、十条自动队列、快捷 Chat 与全局快捷键等 1.3.3 能力继续保留。实际测试、构建和未覆盖范围见 [1.3.4 验证记录](docs/VALIDATION_1.3.4.md)。

## 快速开始

### 使用安装版

1. 从 [GitHub Releases](https://github.com/SkyH1aa/MingshenHarness/releases) 选择所需版本，运行 Windows x64 安装包。
2. 首次启动时阅读三份协议与内置使用手册。
3. 在“设置 → 供应商与模型”添加自己的服务地址、API Key 和模型。
4. 选择 CodeAgent 或 WorkAgent 并指定工作文件夹；如需不带本地工具的普通问答，切换到 ChatAgent 新建独立对话。

安装版无需另装开发用 Node.js/pnpm。项目命令、stdio MCP 和外部运行时按各自依赖配置。应用不提供免费模型额度或 ChatGPT 订阅；界面中的 `Chatgpt Pro` 仅为可编辑的示例供应商名称。

### 从源码运行

需要 **Windows 10/11 x64、Node.js 24+、pnpm 11+**，仓库固定包管理器为 `pnpm@11.25.0`。获取源码后，在仓库根目录运行：

```powershell
pnpm install --frozen-lockfile
node scripts/provision-electron-runtime.cjs
node scripts/provision-native-runtime.mjs
pnpm dev
```

准备脚本会下载并校验固定版本的原生 Windows 沙箱执行器。该 EXE 不随源码提交，新克隆需要执行上述准备步骤；来源与哈希见[运行时说明](apps/desktop/resources/native/PROVENANCE.md)。它只用于沙箱执行，不使用用户的 Codex 账户或模型服务。

需要运行构建后的实验版时：

```powershell
pnpm build
.\run-experimental.cmd
```

实验版使用独立数据目录 `%LOCALAPPDATA%\MingshenHarnessExperimental`。启动器每次都会先核验固定原生沙箱并重新构建当前源码，再启动实验版，避免删除源码、配置变化或产物缺失时误用旧构建。为避免旧实例占用文件，替换构建前仍应先从托盘正常退出正在运行的实验版。

### 执行环境

受保护模式可选择 Windows 原生 MXC 或 Docker。MXC 需要兼容的较新 Windows 11；Windows 10/旧版 Windows 11 使用 Docker。隔离不可用时，受保护操作会停止，不会静默改在宿主执行。

Docker Desktop、WSL2 和 Embiody 属于按需配置的外部依赖，不包含在安装包中。完整要求见[使用手册](docs/USER_GUIDE.md)和[安全说明](SECURITY.md)。

## 模型配置

每个供应商选择一种协议，应用自动追加请求端点。Base URL 不要重复填写完整请求路径。

| 协议 | 典型 Base URL | 鉴权 |
| --- | --- | --- |
| OpenAI Responses | 供应商提供的 `/v1` 地址 | 通常为 `Authorization: Bearer` |
| Chat Completions | 供应商提供的 `/v1` 地址 | 通常为 `Authorization: Bearer` |
| Anthropic Messages | 供应商提供的 `/v1` 地址 | 通常为 `x-api-key` |
| Google Gemini 原生 GenerateContent | `https://generativelanguage.googleapis.com/v1beta` | `x-goog-api-key` |

Gemini 的 Chat Completions 兼容接口使用 `https://generativelanguage.googleapis.com/v1beta/openai`，与原生协议分开配置。DeepSeek 的官方路径按协议区分，完整地址、推理续接及缓存条件见[供应商缓存说明](docs/PROVIDER_CACHING.md)。

每个模型可以配置上下文窗口、输出上限、输入模态、工具能力和思考等级。供应商长按拖动排序、模型星标会同步到聊天、新建会话、子 Agent、审批、压缩和记忆分析等模型选择入口。

图片供应商仍在“供应商与模型”中管理。新增或编辑模型时勾选“图片生成模型”，该模型只负责图片输出，不参与聊天、规划或压缩；文本参数不再显示。生图工作台单独选择图片模型及语言模型，反推提示词要求所选语言模型支持图片输入。当前图片请求使用 OpenAI Images 兼容 `/images/generations`，不嵌入外站账号页面，也不接受供应商只返回远程 URL 的图片结果。

“模型体系”控制适配规则，不转换 API 协议。第三方网关需确认支持对应字段透传。Gemini / DeepSeek 默认使用隐式前缀缓存，不自动创建收费显式缓存资源；命中率由模型、请求、缓存有效期和供应商路由共同决定。

## Agent 模式

主界面标题栏的 CodeAgent、WorkAgent、ChatAgent 用于切换工作方式，不是三个独立模型供应商。三种模式共用供应商、模型、思考等级、上下文压缩和基础运行配置。

| 模式 | 工作区与工具 | 适合的任务 |
| --- | --- | --- |
| CodeAgent | 完整代码工作台、文件/命令、代码索引、诊断、测试与验证工具 | 开发、排障、重构、测试、代码审查和工程交付 |
| WorkAgent | 与 CodeAgent 共用会话和工作目录，并额外提供 Work 专精技能与 `office_document` | Word、Excel、PowerPoint、研究、分析、运营材料和办公成品 |
| ChatAgent | 无需工作目录，只开放 `web_search`、`web_fetch` 和用户主动上传的只读附件问答 | 普通问答、学习、写作、资料整理和不涉及本地文件操作的对话 |

CodeAgent 与 WorkAgent 可在同一会话内切换，不新建工作目录，也不复制历史。任务运行、等待审批、等待回答或正在压缩时不能切换；完成或手动停止后切换只影响下一轮。已有消息、工作目录、草稿、附件、计划、上下文摘要和权限记录不会被清空。ChatAgent 是独立的会话目录与页面，不能与 CodeAgent/WorkAgent 直接互转，也没有工作目录或本地工具入口。

ChatAgent 的侧栏顶部、分组加号、“未分组”加号和空态新建会直接创建空白对话，不再打开完整的新建弹窗。分组内新对话沿用该组最近更新的未归档 Chat 的供应商、模型、推理等级和聊天设置；来源按更新时间选择，不按置顶显示顺序选择。空分组回退最近未归档 Chat，没有 Chat 时使用可用模型默认值。历史、草稿、附件和运行状态不会复制，也不继承 Code/Work 工作目录。

Agent 配置默认同时适用于 CodeAgent 和 WorkAgent，并可勾选限定适用模式；至少保留一个适用模式。ChatAgent 固定使用内置聊天行为，不显示自定义 Agent 配置。设置中的模型、工具、权限和项目指令仍按各模式的实际边界收窄，不会因为共用配置扩大 ChatAgent 权限。

### CodeAgent 工程能力

五个内置工程技能覆盖工程开发、前端、后端与数据、排障和验证，按任务继续加载仓库侦察、大型改动、故障取证、测试设计及发布安全参考。连续相同工具失败会触发策略调整要求，代码索引、LSP、诊断和测试/Lint/类型检查支持最多三轮修复验证。

大工具输出在有界保留区内由 `read_tool_output` 分页恢复，明确标注中间缺口及淘汰限制。逐文件写前检查点仅适用于主会话、完全访问、宿主执行下的受管文件工具，受文件大小和累计预算约束；命令及外部 MCP 副作用不属于逐文件快照保证。容量和验证边界见[使用手册](docs/USER_GUIDE.md)及[CodeAgent 调研与实现](docs/CODE_AGENT_RESEARCH_1.3.3.md)。

`spawn_subagent` 返回后台任务后，主 Agent 可继续独立工作，再由 `wait_subagents` 收集真实结果。SubAgent 没有固定 10 分钟总运行期限，仍会在明确完成、失败、用户停止或父任务取消时结束；单次模型、工具及网络请求保留各自超时。

### WorkAgent 办公能力

| 格式 | 创建、编辑与排版 |
| --- | --- |
| Word / DOCX | 无占位符旧稿文字与区段替换、段落格式、表格列宽、模板、原生可编辑公式、图表与页眉页脚 |
| Excel / XLSX | 结构化创建与编辑、公式、样式、表格、筛选、冻结、列宽、合并、打印区域及工作簿结构检查 |
| PowerPoint / PPTX | 原生可编辑幻灯片、图表与备注，旧稿文字/表格/备注受控修改，封面、章节、时间线、数据与收束等版式 |
| PDF | 读取、离线中英文 OCR，以及文字、Markdown、公式、表格和图片排版输出 |

办公工作流覆盖研究、分析、写作、数据表达、运营与成品质量，先明确受众、论证、语气及信息结构，再选择排版。Word、PDF、PPTX 提供 `executive`、`consulting`、`editorial`、`minimal` 四种设计预设与三种密度；Excel 可统一报告标题、表头、正文带和打印设置。

旧稿修改需先读取结构并核对源 SHA-256，默认另存，拒绝歧义选区和不支持的复杂结构。可选 Office COM 重算/渲染仅用于 Work 主会话、完全访问、宿主执行，并要求 Microsoft Office 已安装、空闲且策略允许；不满足条件时保留结构检查，明确标注重算或渲染未验证。应用不会自动安装 Office，结构检查也不等于视觉验收。格式能力与限制见[文档工具说明](docs/DOCUMENT_TOOLS.md)。

## 技能与本地插件

CodeAgent 与 WorkAgent 自动发现内置能力和所有已安装且启用的 Skills/插件，按上下文检索，再由 `use_skill` 读取相关正文或参考。输入框“+ → 引用”也可手动选择，选中项优先，选择随会话保存；内置 Skill/Plugin 合计最多 32 项。手动引用不关闭自动发现，停用扩展不进入结果。加载及受控预载仍遵守 Agent 配置和审批，发现本身不执行脚本或扩大权限；GitHub、浏览器两类内置 Plugin 的引用只表达工具偏好，不会自动登录或连接服务。

CodeAgent 有 9 个基础技能入口；WorkAgent 有 16 个基础入口，另有 **98 个当前活动来源技能**。`WorkAgentSkill/` 的 124 个物理来源、104 个不同源正文 SHA 和 93 个名称仍完整保留用于溯源；同源、同路径的 9 组历史版本中，26 个旧版本不再重复进入自动发现或手动引用列表。比较使用语义版本，独立来源及不同用途不会按名称或正文 SHA 合并。PDF 的 10 个物理来源仍保留，当前展示 production、viewer、reading 和 loose 四种独立来源。旧会话的选择对应到最新版，旧配置的拒绝或审批规则继续生效。PPT Master 6.9.0、ASD-STE100 0.4.0 及这些来源仅对 WorkAgent 提供，Code 保持原有范围；切回 Work 后恢复其会话选择。正文按需加载，不把来源数当作独立原创技能数。出处与逐项映射见[Work 技能清单](apps/desktop/resources/prompts/skills/work-sources/inventory.md)和[第三方说明](THIRD_PARTY_NOTICES.md)。

本地插件使用 `.mingshen-plugin/plugin.json`，可声明 Skills、Markdown 命令、MCP 和受控 Hook；同时兼容 `.codex-plugin`、`.zcode-plugin` 与旧根清单。设置 → Skills 与插件 → 本地插件开发市场支持添加 `marketplace.json`、校验、手动安装、启停及更新。安装生成独立副本，源码变更后需更新；单扩展最多 20,000 文件、64 MiB。主 Code/Work 的宿主 Windows 会话可按读取权限和审批使用只读 `local_plugin` 检查工作区内源码，安装与更新由用户在设置中完成。动作型 Hook 还需当前主会话引用、已信任项目、完全访问及宿主执行，并按动作审批。兼容清单不表示兼容第三方私有 API，上游脚本和依赖也不会自动安装或执行。

内置 `skill-creator`、`plugin-creator`、`harness-plugin-api` 可指导创建自己的 `SKILL.md`，或生成插件、Harness 适配技能、市场条目和手动安装说明。开发步骤、宿主校验、SDK 及完整安全边界见[本地插件接口](docs/LOCAL_PLUGINS.md)。ChatAgent 不加载 Skills、插件、MCP、Hooks 或自定义 Agent。

## 下一轮自动队列

主界面 CodeAgent、WorkAgent、ChatAgent 的主会话运行中，可点击“加入下一轮队列”，保存预编辑的文字及验证后的附件。每会话最多 **10 条待发消息**，当前执行不计入上限；单附件最多 25 MiB，队列附件合计最多 50 MiB。支持编辑文字、整体替换附件和删除，严格按首次加入顺序发送，不提供重排。

上一任务正常完成且后台清理结束后，自动发送队首，之后依次执行；切换到其他会话或收起窗口不影响派发。编辑时暂停发送，保存或显式取消后才允许继续。手动停止、运行失败、附件替换失败、自动发送失败、应用重启或编辑窗口丢失时保留并暂停队列；显式恢复或同会话后续一轮正常成功后从首项接续。审批等待不会推进，配置变化或派发结果未确认时阻塞队首，不会跳过。

队列不随 fork 复制，删除会话时清理；快捷 Chat 和实际 SubAgent 不提供队列。完整生命周期与防重放边界见[T3 Code 调研与自动队列](docs/T3_CODE_RESEARCH_1.3.3.md)。

## 快捷 Chat 与快捷键

| 默认快捷键 | 操作 |
| --- | --- |
| `Ctrl+M` | 打开快捷 Chat，已显示时再次按下收起 |
| `Ctrl+Alt+L` | 显示并聚焦主界面；主界面已获得焦点时收回托盘 |

快捷 Chat 复用 ChatAgent 的模型、联网、上传附件和压缩规则。首次唤起创建新会话，10 分钟有效期内再次唤起复用并重新续期，过期后的下一次唤起新建；旧对话保留在 Chat 历史中。小窗隐藏保留草稿，支持新建、停止、打开主界面、`Esc` 收起及持久化置顶，不接入 Code/Work 工作目录或本地工具。

两项快捷键均可在设置 → 外观与语言 → 全局快捷键录制，支持 `Ctrl`、`Shift`、`Alt` 多修饰键与一个主键，包括三键和四键组合。默认 `Ctrl+M` 为二键、`Ctrl+Alt+L` 为三键；自定义组合至少包含一个修饰键和一个主键，两项不可冲突。保存时实际注册检测占用，失败保留原有效绑定并提示，可恢复默认。

## 工作区与项目记忆

CodeAgent 和 WorkAgent 的会话按工作文件夹组织，可搜索、分支、归档和批量管理。ChatAgent 在独立对话页按分组、置顶和归档管理，不要求文件夹。待发送文字、格式状态和附件自动保存草稿，切换会话或正常重启后恢复；发送被接收、手动清空或删除会话时移除相应草稿。

输入框默认以 Markdown/LaTeX 原文编辑；粘贴、键入、输入法组合和快捷键不会自动跳到格式预览。只有用户手动点击眼睛按钮才会切换预览，预览选择会随草稿保存并在正常恢复时保留，发送始终使用原文。设置 → 外观与语言可关闭输入区的预览按钮。“简约”和“光轨”共用会话与功能，界面风格在重载或重启后生效。

光轨将会话、聊天、文件审查、终端与任务放在连续工作平面中，日夜主题共享紧凑的信息层级和键盘焦点反馈。任务区支持拖动或键盘调整高度、恢复默认和单行收起，偏好按工作区保存；窄窗使用抽屉。Work 空会话提供 Word、Excel、PPT 起始草稿，点击只填入输入框。未保存计划时，跨会话导航、新建及归档当前会话或其祖先前会提示先保存或取消；状态动效遵循应用及系统的减少动态效果设置。

设置 → 项目指令与信任可按工作区选择：

| 记忆后端 | 本地目录 | 自动维护 |
| --- | --- | --- |
| 原生 Memory | `.harness-memory/` | 偏好、任务日记摘要、检索与归档 |
| TencentDB 本地核心 | `.harness-tencent-memory/` | 记忆分析模型提取语义记忆，再判断存储、跳过、更新或合并 |

工作区内的项目 Agent 配置和项目指令仍应先核对来源。OpenCode/Mingshen 项目 JSON 与项目 Markdown Agent 只会在该工作区已信任后加载；项目配置通过 `{file:...}` 引入的指令必须位于当前工作区内，并以句柄级受限读取拒绝链接或越界文件。项目 `build` 不会改写内置 `primary`，而是创建独立项目 Profile；撤销项目信任会清理对应项目来源。LSP 也只能查询当前工作区内、经过路径边界检查的真实文件。

TencentDB 可配置分析主备模型；主模型留空时使用当前主会话模型。提取与冲突判断提示复用固定上游版本的通用 `chat` 模板，宿主校验结果后原子保存。分析失败不会改存完整回答或规则摘录，切换后端保留两套目录。

该集成使用 TencentDB Agent Memory 的本地核心，不接入腾讯云记忆服务，也不等同于完整上游产品。固定版本、原文提示来源、集成范围与许可见[第三方说明](THIRD_PARTY_NOTICES.md)。

## 创作与项目工作面

标题栏的“工作站”和“生图”可随时进入独立工作面，对话继续保留在原会话。工作站可按类别、格式和多关键词筛选 780 个场景；新建草稿默认详细版，旧草稿没有版本字段时按简略版恢复。切换简略/详细不会重置标题、备注或章节，完整提示词可预览和复制，推荐技能写明 ID 和使用理由。填写目标、受众、资料、风格与约束，再调整章节并交给 WorkAgent；交接只追加草稿，生成仍遵守会话权限与验证流程。完整范围见[工作站模板说明](docs/WORKSTATION_TEMPLATES.md)。

生图画布支持多个工程、平移缩放、图层位置、尺寸、旋转、透明度与层级调整，可导出画面或携素材的工程文件。素材由用户导入或模型生成，保存在应用本地目录；PNG、JPEG、WebP、GIF 经过有界完整解码校验，暂不支持 APNG。图像反推仅将明确选中的素材发给所选视觉语言模型。图片生成和文字润色分别使用所选供应商，具体费用与协议支持由供应商决定。

项目图标栏用于切换项目，分支/worktree 分组使用会话创建时记录的分支信息；旧会话没有记录时明确显示未记录。`Ctrl+Shift+P` 打开命令面板，文件结果限定当前 Code/Work 工作区。交互终端由用户主动新建，只用于已信任项目中的主 Code/Work、完全访问及宿主/worktree 会话；Agent 的命令工具仍沿用原执行与审批流程。Shell 以当前 Windows 用户身份运行，可访问该用户有权访问的位置，工作目录不构成文件系统隔离。终端关闭、会话移除和应用退出会尝试有界清理受管进程，清理失败时明确显示未确认状态并保留重试入口。

本地审阅的四个范围为 Git 工作区、分支差异、当前会话和上一轮。选择旧行或新行后可暂存评论并加入输入框；提交前会重新核对 diff 版本，已变化的评论不会静默套用到新代码。评论、模板和 AutoDrive 方案均先进入草稿，由用户发送。

## 数据与安全

会话、配置、草稿和工作记录默认保存在本机。凭据通过系统 `safeStorage` 保存；普通会话、附件和项目记忆不属于凭据加密。数据库保留历史迁移，启动时自动升级旧数据；重要升级前应备份完整数据。

聊天、上下文压缩、自动审批、记忆分析及其备用模型会按配置向对应供应商发送所需内容，并可能产生 API 用量。Gemini 签名和 DeepSeek API 实际返回的明文推理可能随会话保存；外部 MCP 和扩展也有各自的数据边界。运行日志支持用户主动脱敏导出，不自动上传。

ChatAgent 只能解析用户主动上传的位图、PDF、Word、Excel 和 PPTX 文件，文件名或消息中的路径不会变成本地读取权限。每条消息最多 10 个附件、单文件最多 25 MiB、合计最多 50 MiB；图片还会在草稿和发送边界核对 MIME、文件头签名，SVG、伪装内容和旧版二进制 `.ppt` 会被明确拒绝。它只开放联网检索和网页读取，不运行浏览器自动化、命令、MCP、Skills、Hooks 或子 Agent，也不能创建、修改或删除本地文件。WorkAgent 的可选 Office COM 验证只在系统已安装 Office 且执行策略允许时使用临时副本；不会自动安装 Office，也不会把结构检查当作公式重算或页面渲染证明。

文件、命令和扩展操作仍需按权限执行。审批是操作授权，worktree 用于工作目录分离，两者都不能代替进程隔离。持续命令工具使用管道，不支持完整 PTY；定时任务需要应用保持运行。

请阅读[安全说明](SECURITY.md)和[隐私政策](docs/PRIVACY_POLICY.md)，并按任务需要配置模型、扩展及工作区权限。

## 开发与构建

应用使用 Electron、React、TypeScript 和 SQLite，包管理器为 pnpm。

### 源码检查

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

固定任务基线可用 `node scripts/harness-eval.mjs`，默认仅运行临时工作区中的合成夹具，不调用模型。桌面专项和真实服务测试的执行条件见对应验证记录。

### Windows 打包

```powershell
# 仅检查环境、必需资源、依赖与版本
.\package-win.cmd --check

# 可选：构建解包程序，不生成安装器
.\package-win.cmd --dir

# 生成正式 Windows 安装器及 ZIP 更新材料
.\package-win.cmd
```

脚本自动寻找 Node.js/pnpm，仅为当前进程补齐 PATH。已配置好环境时也可使用 `pnpm package:win`。完整打包会先检查 Electron，缺少运行时时调用已安装 Electron 包的官方安装器，再准备图标与固定沙箱、构建应用、校验必需资源和第三方哈希，并在 afterPack 再次检查。

原生依赖准备会保留经固定 SHA-256 校验的 `node-pty 1.1.0` 官方 Windows x64 Node-API 预编译文件，并使用官方 `@electron/rebuild` 处理其余生产/可选依赖；全部成功后才启动打包器，避免重复源码重编触发 `MSB8040`。无需为当前官方预编译方案额外安装 Visual Studio Spectre 库，也不会修改上游编译防护。缺失、篡改、未知版本或优先加载的旧编译文件会明确拒绝；`--check` 仍只是资源预检，不运行完整重编或 NSIS。

迁移仓库目录后，在新目录先执行 `pnpm install --frozen-lockfile`，同步依赖安装路径。`--check` 只检查，不下载；如果报告 Electron 运行时缺失，可执行 `node scripts/provision-electron-runtime.cjs` 后重新检查，也可直接运行完整打包入口，由它自动准备。运行时按当前工作区的模块解析定位，兼容根目录 hoisted 与桌面应用本地依赖布局。

源码预检还会核对 `WorkAgentSkill/`、`ppt-master/` 和 `asd-ste100-skill-master/` 中的来源与随包副本，打包前请保留这些目录及 `apps/desktop/resources/prompts/skills/`。安装后的应用使用随包技能资源，不依赖开发仓库。正式打包会自动重建应用，无需预先单独执行 `--dir`。

当前目标为未签名、当前用户安装的 x64 NSIS，输出目录为 `apps/desktop/release-artifacts/`：

```text
MingshenHarness-1.3.4-x64.exe
MingshenHarness-1.3.4-x64.zip
MingshenHarness-1.3.4-x64.zip.sha256
MingshenHarness-1.3.4-x64.zip.json
```

构建缓存位于 `%LOCALAPPDATA%\MingshenHarness\BuildCache\windows-1.3.4-*`。如果构建成功但文件复制回项目失败，控制台会打印 `Cached installer:` 或 `Update artifact retained in build cache:`，可按提示在缓存的 `output/` 中核对并取得对应 EXE、ZIP、SHA256 和 JSON；这些文件分别复制，不能只凭退出码认定项目目录中的材料已齐全。遇到 `EPERM`、`EACCES`、`EBUSY` 时，排查方法见[开发交接与打包指南](AGENT.md)。

自行分发时需核对 [release.ts](apps/desktop/src/shared/release.ts)、GitHub OAuth 和 Supabase 更新服务配置。发布材料使用本次 ZIP 实际生成的哈希与大小；`supabase/` 中的历史发布 SQL 只适用于对应旧包。配置方法见[GitHub OAuth 指南](docs/GITHUB_OAUTH_SETUP.md)和[更新服务部署指南](docs/SUPABASE_DEPLOY.md)。

### 仓库结构

```text
apps/desktop/
  src/main/             主进程、模型、Agent、工具、存储与隔离
  src/preload/          typed IPC 桥接
  src/renderer/         React 界面
  src/shared/           共享类型、配置与发布信息
  resources/            提示词、文档 worker、LSP、SDK 与第三方运行资源
  build/                正式 PNG / ICO 图标
docs/                   双语手册、协议、更新日志与验证记录
scripts/                构建、资源准备、检查、桌面验证与合成夹具
supabase/               更新服务迁移和历史发布 SQL
third_party/            固定 TencentDB 上游源码、适配及许可
```

`resources/lsp/`、`resources/tencentdb-memory/`、正式图标与合成测试夹具属于仓库资源。原生沙箱 EXE 则由准备脚本恢复。[.gitignore](.gitignore) 已排除依赖、构建产物、本地项目记忆、数据库和环境密钥。

开发前请阅读 [AGENT.md](AGENT.md)，了解代码位置、版本约束、数据保护及验证方法。[DESIGN.md](DESIGN.md) 记录界面约定。

### 问题反馈

提交 Issue 时请提供应用版本、Windows 版本、复现步骤、预期行为和实际结果。供应商兼容问题请同时注明协议和模型 ID，可附脱敏日志或截图；请移除 API Key、账户信息、私人路径及对话内容。

验证记录区分本地合成服务、真实集成和未覆盖范围，源码检查通过不代表所有供应商、Windows 配置或安装升级流程已经验收。当前版本证据见[1.3.4 验证记录](docs/VALIDATION_1.3.4.md)，历史功能基线见[1.3.3 验证记录](docs/VALIDATION_1.3.3.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用手册](docs/USER_GUIDE.md) / [English](docs/USER_GUIDE.en.md) | 安装、设置、会话、工具与扩展 |
| [更新日志](docs/CHANGELOG.md) / [English](docs/CHANGELOG.en.md) | 各版本完整变更 |
| [1.3.4 Release 文案](docs/RELEASE_1.3.4.md) / [1.3.3](docs/RELEASE_1.3.3.md) | 当前发布标题、中英文简介与历史版本亮点 |
| [1.3.4 验证](docs/VALIDATION_1.3.4.md) / [1.3.3 验证](docs/VALIDATION_1.3.3.md) | 当前修复验证、历史功能基线及未覆盖范围 |
| [三模式与办公调研](docs/AGENT_MODES_RESEARCH_1.3.3.md) | CodeAgent / WorkAgent / ChatAgent 边界、办公与开发能力来源及安全取舍 |
| [Crow5 功能对比](docs/CROW5_COMPARISON_1.3.4.md) | 基于公开资料的 Crow5 与 MingshenHarness 1.3.4 功能差异研究；不代表实测或实施计划 |
| [CodeAgent 调研](docs/CODE_AGENT_RESEARCH_1.3.3.md) / [WorkAgent 办公调研](docs/OFFICE_AGENT_RESEARCH_1.3.3.md) | Codex 工程工作流、ZCode / WorkBuddy 公开办公机制、原创实现映射及边界 |
| [本地插件接口](docs/LOCAL_PLUGINS.md) | 原生清单、Skill/命令/MCP/Hook、Creator、开发市场、手动安装、更新和安全边界 |
| [文档工具](docs/DOCUMENT_TOOLS.md) | 原生公式、富内容表格、Markdown、模板及格式限制 |
| [供应商缓存](docs/PROVIDER_CACHING.md) | 协议、缓存、原生状态与官方来源 |
| [安全说明](SECURITY.md) / [第三方许可](THIRD_PARTY_NOTICES.md) | 信任边界、依赖、来源与许可 |
| [GitHub OAuth](docs/GITHUB_OAUTH_SETUP.md) / [更新服务](docs/SUPABASE_DEPLOY.md) | 账户集成和分发配置 |
| [服务协议](docs/TERMS_OF_SERVICE.md) / [隐私政策](docs/PRIVACY_POLICY.md) / [免责协议](docs/DISCLAIMER.md) | 内嵌用户协议，修订号 `2026-11-04.3` |
| [开发交接](AGENT.md) / [界面约定](DESIGN.md) | 维护入口、代码结构、数据保护与验证边界 |

## 许可

当前项目许可标记为 **`UNLICENSED`**，尚未提供根项目开源许可证。源码公开展示不代表已授予使用、修改或分发授权；正式许可安排以维护者后续发布的许可证为准。

第三方组件分别遵循自己的许可；社团名称、产品名称和图标的使用权不随源码仓库访问权限自动授予。
