# 1.3.3 Agent 模式与办公能力调研

调研日期：2026-11-17（Asia/Shanghai）。版本保持 1.3.3。公开仓库以当日可读取的 main 分支为依据，后续可能变化。

## 当前交付状态

本轮已修改本地扩展和技能市场的单扩展文件数量上限到 20,000，并补齐边界与真实小目录导入回归。64 MiB 总大小保留。Skills 已由启动时注入全部正文改为元数据目录和 `use_skill` 按需分页读取；单页最多 32,000 字符，资源读取有路径、类型和大小检查。

用户已答复五项产品边界并授权实装。主界面三模式、独立 Chat 会话分组、schema9 增量迁移、Work Office 工具、21 个基础能力入口（其中 19 个原创工作流、2 个 Work-only 开源资源适配）、连续失败保护、可恢复输出和受限范围检查点已进入源码。本文件区分公开机制与实际实现；最新测试、桌面证据和未验证项以 [1.3.3 验证记录](VALIDATION_1.3.3.md) 为准，源码实现不等于正式安装包验收。

## 官方来源与可迁移机制

| 来源 | 实际公开机制 | 对本仓库的意义 |
| --- | --- | --- |
| [Anthropic Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) | 按元数据发现、按需加载正文、继续按需使用脚本和资源 | 内置办公能力包采用渐进加载，避免所有办公说明同时进入上下文 |
| [Microsoft Copilot in Word FAQ](https://support.microsoft.com/en-us/office/copilot-in-word-faq-7ca2e1f5-bfa3-4dd5-b8f0-4f7649557116) | 围绕工作内容生成、改写和审阅，要求核查输出 | 保留源材料、引用与修改预览，交付前验证；产品说明未公开内部实现，不能据此声称复刻其引擎 |
| [Microsoft 365 Copilot 架构](https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-architecture) | 模型、工作数据 grounding、继承权限与工具执行共同协作 | 专精来自工作数据与确定性工具，模式名称和长提示词只能承担其中一部分 |
| [Excel Copilot](https://support.microsoft.com/en-us/excel/copilot/get-started-with-copilot-in-excel)、[Office JS calculate](https://learn.microsoft.com/en-us/javascript/api/excel/excel.application?view=excel-js-preview#excel-excel-application-calculate-member(1)) | 使用原生公式、表格、图表与数据分析功能；Office JS 公开计算模式和显式重算接口 | Work 要检查公式、输入类型与关键单元格；重算须调用实际计算器并报告状态 |
| [PowerPoint Copilot FAQ](https://support.microsoft.com/en-us/powerpoint/frequently-asked-questions-about-copilot-in-powerpoint) | 从主题/文件创建、使用模板、重写文本框和协作修改，同时存在对象和规模限制 | 受控编辑与逐页视觉检查优先，复杂演示稿需报告支持边界 |
| [Cline Plan/Act](https://github.com/cline/cline/blob/main/docs/core-workflows/plan-and-act.mdx)、[Checkpoints](https://github.com/cline/cline/blob/main/docs/core-workflows/checkpoints.mdx) | 同一会话规划/执行；独立 shadow Git 快照及文件/任务恢复选择 | 已有只读 Plan 和运行开始快照，后续完善检查点粒度与恢复语义 |
| [Cline Skills](https://github.com/cline/cline/blob/main/docs/customization/skills.mdx) | 元数据、正文、资源三层加载；正文按任务激活 | 已接入原创目录与 `use_skill` 分页，内置和导入技能均按需读取 |
| [Cline mistakes](https://github.com/cline/cline/blob/main/apps/cli/src/runtime/interactive/mistakes.ts) | 对连续调用/执行失败设门限并请求换策略或停止 | 给 Code/Work 增加连续失败识别，减少无效重试和重复修改 |
| [PenguinHarness Core](https://github.com/Prism-Shadow/penguin-harness/blob/main/packages/core/README.md) | 流式任务循环、逐工具审批、受控并发、压缩、中断与轨迹恢复 | 沿用已有主循环，针对缺口优化，不重复建一套执行器 |
| [Penguin 工具原文归档](https://github.com/Prism-Shadow/penguin-harness/blob/main/packages/core/src/environment/truncated-tool-output-archive.ts) | 截断结果附会话级原文路径，按容量保存完整内容或头尾；沿用读取工具恢复 | 大日志保留可恢复入口，须继续经过会话授权、容量和清理边界 |
| [Penguin data-analysis](https://github.com/Prism-Shadow/penguin-harness/blob/main/plugins/data-analysis/skills/data-analysis/SKILL.md) | 有界读取、数据粒度、公式与重算、原生格式、按风险验证 | Work 的表格任务需有数据检查与交付验收，不能仅把工作簿读成 CSV |
| [Penguin bento-slides](https://github.com/Prism-Shadow/penguin-harness/blob/main/plugins/use-bento-slides/skills/bento-slides/SKILL.md) | 产物是自包含 HTML 演示稿 | 适合参考演示排版流程；不能将其宣传为 PowerPoint 旧稿编辑能力 |
| [Trae tools](https://github.com/bytedance/trae-agent/blob/main/docs/tools.md)、[Trajectory](https://github.com/bytedance/trae-agent/blob/main/docs/TRAJECTORY_RECORDING.md) | 持久 Bash、唯一字符串替换、JSONPath 和显式完成；记录请求、工具、错误、耗时 | 在已有命令/LSP/AST/格式化基础上完善结构化编辑和失败复盘；任务完成声明须与真实验证结果关联 |
| [Trae task_done 源码](https://github.com/bytedance/trae-agent/blob/main/trae_agent/tools/task_done_tool.py) | 执行本身只返回完成文本，验证要求主要在工具说明 | 不能把完成按钮或提示词要求当作构建/测试确已通过的证据 |
| [CommandCode README](https://github.com/CommandCodeAI/command-code/blob/main/readme.md)、[仓库元数据](https://api.github.com/repos/CommandCodeAI/command-code)、[npm 元数据](https://registry.npmjs.org/command-code/latest) | README 宣称接受/拒绝/编辑反馈形成偏好；实现未公开可审计，仓库没有声明许可证，npm 标记 UNLICENSED | 仅研究公开交互概念；若采用偏好反馈，需原创、本地保存、可关闭/清除，不声称具有其未公开的模型能力 |

Cline 和 PenguinHarness 的根许可证为 Apache-2.0，Trae Agent 为 MIT，见各仓库 [Cline LICENSE](https://github.com/cline/cline/blob/main/LICENSE)、[Penguin LICENSE](https://github.com/Prism-Shadow/penguin-harness/blob/main/LICENSE)、[Trae LICENSE](https://github.com/bytedance/trae-agent/blob/main/LICENSE)。本轮研究公开机制并独立实现，没有复制第三方 Agent 或技能文件；将来复用文件时仍须逐文件核查来源和通知。Trae Agent 是 ByteDance 的开源软件工程 Agent，不等同于完整 Trae 商业 IDE。

[OpenAI skills](https://github.com/openai/skills) 当日页面已标记 deprecated 并指向 [OpenAI plugins](https://github.com/openai/plugins)。插件及文件各有许可，不能按一个根许可整体搬运；本机官方 Office 技能和运行时也不作为本产品可再分发依赖。本轮只整理渐进加载、批量结构化操作、重算、包结构检查及渲染验收等通用工程模式，没有复制其提示词、脚本或资产。现有技能市场迁移不属于本次文件数量修复，需另外核对替代仓库结构与许可。

## 已有能力与实际增量

| 领域 | 前轮源码已有 | 本轮实现的增量 |
| --- | --- | --- |
| Word | DOCX 读取、源 SHA/结构编号、无占位符局部编辑、模板、表格、图片、原生公式与精细排版 | 原创长报告/旧稿工作流，Work 完成前结构检查和可选 COM 渲染；COM 前拒绝非普通超链接外部关系及跨 run 自动字段。曾出现 Word COM 打开超时，仍不能称其已验收 |
| Excel | 内置 SheetJS；工作表内容读取，原生图表所需内嵌工作簿 | ExcelJS 4.4.0 结构化创建/编辑、区域/公式/样式/列宽/冻结/筛选/原生表格；源 SHA 绑定，未改包部件保留；可选 Excel 真重算与缓存复核 |
| PowerPoint | 原生 PPTX 生成、图片、表格、图表、备注与基本溢出检查 | 商务主题、封面/页脚/页码；旧稿 shape/table/notes 索引、源 SHA、受控文字/表格单元格/备注编辑；可选 PowerPoint 导出 PDF，未增加任意旧稿图片/动画编辑 |
| PDF | 提取、OCR、生成与 Chromium 排版 | `read_document render:true` 返回有界页面图片，支持图像输入的模型可继续检查；导出和目视通过分别报告 |
| CodeAgent | 文件/精确补丁、LSP、AST 索引、格式化、持久命令、测试诊断、子任务、运行快照与轨迹 | 5 个代码专精工作流及共享质量流程、失败指纹换策略、会话隔离输出归档和分页、full-access host 下文件级受限范围检查点 |

SheetJS 的读写能力不等于公式计算引擎。没有实际计算器时，必须将“公式已写入”“缓存结果已验证”“执行重算后通过”分别报告。Office/LibreOffice 的最终排版与语义 HTML 预览也应分别记录。复杂宏、签名、外链、OLE、SmartArt、动画和扩展部件需要拒绝或保真复制策略，不能因为 ZIP/XML 校验通过就宣称完全无损。

所有新文档工具继续通过现有 profile、审批、隔离、原子写入、源 SHA、写入协调与取消网关。可选 Office COM 不能在受保护模式失败时静默回退到宿主；渲染和重算均需控制进程生命周期、超时与输入范围。COM 打开前还要检查跨包外部依赖、自动字段和表格数据连接，采用临时副本和空实例所有权确认；无法证明实例为空时宁可降级，也不关闭或清理可能属于其他会话的 Office 进程。

## 三模式实现约束

1. 主界面提供 CodeAgent / WorkAgent / ChatAgent 入口，沿用简约/光轨主题。Code/Work 使用同一工作台、工作目录与会话；模式和已有 host/worktree/docker 执行隔离字段分开管理。
2. Code 保留原有权限。Work 共用执行引擎和权限，不增加隐式授权；办公专精落实为实际工具、按需工作流和验收，不只改变系统提示词。
3. Chat 使用独立页面、会话目录及选中状态，不选工作目录。支持手动分组、移动、搜索、重命名、置顶、归档、恢复与删除；分组不复用工作目录字段。
4. Chat 在工具发现前分流，在实际执行入口再次校验网络白名单；明确跳过项目指令、Skills、MCP、自定义工具、Hook、子 Agent 和本地工作区记忆。仅设 workspacePath=null 不够。
5. 三模式共用供应商、模型、上下文压缩、重试和基础设置。Chat 不提供自定义 Agent Profile。旧会话应增量迁移为 Code，不复制/清空历史或创建新的用户数据目录。
6. 迁移须覆盖创建、fork、子会话、API、目录分页和启动选中；模式切换不能让运行中工具策略漂移。持久化、IPC 与 UI 需一起验证，不能只改下拉框。
7. 运行锁按会话记录，不只依赖主循环已经产生 `live` 状态。编辑后重发要在 IPC 前加锁；草稿刷新和附件 `FileReader` 准备阶段也提前锁住当前模式，准备完成后由启动/运行锁接续，整体保持到本轮收到完成、失败或中断事件。IPC 启动失败可立即释放准备/启动锁，其他并发会话不能被误释放或因当前会话切换而一并锁住。

## 已确认并执行的边界

- Chat 支持用户主动上传图片、PDF、DOC/DOCX、XLS/XLSX、PPTX；旧二进制 PPT 不在解析器支持范围。只解析上传字节，丢弃调用者提供的本地路径和预提取内容，校验真实字节数与单文件 25 MiB 限制。
- Chat 工具严格只有 `web_search`、`web_fetch`；不启动或提供 MCP、Skills、命令、浏览器操作、Hook、自定义工具或子 Agent。
- 已安装且当前空闲的 Office 可做可选 COM 重算/渲染，仅 Work 主会话的 full-access host 路径启用。不自动安装 Office，隔离/权限不允许或 Office 已占用时明确降级；操作临时副本，按记录的确切自动化进程身份清理。
- COM 自动化开始前检查非普通超链接外部关系、Word 自动字段及 XLSX 数据连接部件；命中时保留结构检查并降级。创建实例后先核对确切 owner，再确认文档集合为空，最后才登记 owner；非空或未确认实例不登记可清理身份，不关闭或退出其文档。Word 使用隐藏只读、16 参数的 `OpenNoRepairDialog` 打开方式，不修改用户 Office 全局设置，也不把该包装当成本轮渲染验收。
- Code/Work 运行中锁定切换，手动停止或完成后才切；保留会话、目录、历史、草稿和附件。Chat 与工作区会话不可直接互转。
- 旧自定义 Agent Profile 默认适用 Code/Work；可限定其中之一，Chat 无自定义 Profile。供应商、模型、压缩与基础配置共用。

## 实现位置与容量边界

- `agents/domain-skills.ts` 与 `resources/prompts/skills/`：代码 5 项、办公 6 项、共享质量 1 项原创流程，先列元数据，正文按需读取。
- `chat/failure-loop-guard.ts`：同工具及等价 JSON 参数连续失败 3 次后要求改策略；12 次连续失败后停止本轮，成功调用重置连续计数。
- `tools/bounded-output.ts`、`chat/tool-output-store.ts`：单结果保留最多 4,000,000 个 UTF-16 字符的头尾并标记中间缺口；单会话最多 40 条、16,000,000 字符，`read_tool_output` 按调用 ID 恢复。超出捕获上限的缺口不能恢复，删除会话同步清理。
- `workspace/snapshot-service.ts`：原运行开始快照继续保留；主会话 full-access host 的文件工具写入前创建局部检查点，恢复只触及记录范围，并先建同范围安全点。单文件 25 MiB、单点/单轮累计 128 MiB、每轮最多 128 个局部点，超额后明确提示。任意 shell 或外部 MCP 副作用不享有逐文件写前快照保证。
- `documents/office-document*`、`tools/tool-registry.ts`：结构化 schema、资产读取和输出预检、源 SHA、正常审批/隔离、文件锁、冲突检查及每个文件的原子提交。PDF 与重算工作簿不是一个跨文件事务。COM 分支另有外部关系/自动字段/数据连接预检、精确 owner 与空实例确认、最后阶段诊断和脱敏超时报告；普通 inspect/edit 不套用 COM 专属预检。
- `storage/database.ts` 的 schema9 顺序追加模式与分组；旧 schema1-8 迁移保留。`ChatService`、ToolRegistry 和会话更新入口分别强制执行 Chat 白名单、模式适用与运行中锁定。
- `renderer/App.tsx`、`components/ChatView.tsx` 与 `lib/agent-mode-ui.ts`：Code/Work 切换使用会话级启动锁和准备锁；附件读取、草稿落盘与编辑重发在等待 IPC 时已禁止切换，运行结束事件后释放对应会话，不使用全局单锁覆盖其他并发会话。

## 验收方向

- 安全：伪造/历史工具调用无法突破 Chat 网络白名单；启用的全局 MCP/插件不启动、不注入；供应商与压缩仍正常工作。
- 数据：旧 schema8 迁移保留全部会话、消息、附件、扩展和配置；Chat 与 Code/Work 目录互不混入；分组与归档跨重启保留。
- 文档：用真实 DOCX/XLSX/PPTX 夹具验证原稿与未改部件、公式状态、输出结构、渲染与故障不写半份文件；所有未执行的渲染/重算明确标注。
- 开发：构建/测试/诊断结果与完成状态关联；连续失败能换策略或停下；归档输出和检查点可恢复且不绕过权限。
- UI：主界面切换、两种风格/日夜/窄窗、长名称、键盘焦点、草稿保留及运行中切换提示均需真实 Electron 验证。
