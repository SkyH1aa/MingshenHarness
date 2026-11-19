# Mingshen Harness V1.3.3 | 三模式工作台、办公工作流与自动消息队列

建议 Tag：`V1.3.3`。发布时将此标签指向包含本版本改动的最终提交，以下文档链接使用相同标签。

## 中文简介

Mingshen Harness 1.3.3 将编程、办公与日常对话整合为 CodeAgent、WorkAgent 和 ChatAgent 三种工作方式。本次更新强化 Office 文档制作与排版、工程验证、Skills 与本地插件开发，同时带来最多十条自动消息队列、后台 SubAgent 协作、快捷聊天小窗和升级后的光轨工作台。

## 本次亮点

- **三种 Agent，主界面切换**：CodeAgent 与 WorkAgent 共用会话、历史和工作目录，可在任务结束后切换下一轮模式；ChatAgent 使用独立分组对话页，支持搜索、重命名、置顶、归档与恢复，以及联网和主动上传附件的只读问答。
- **更细致的办公交付**：支持 DOCX 旧稿局部修改与精细段落排版、结构化 XLSX 创建和编辑、PPTX 旧稿文字/表格/备注受控修改，以及 Word、PDF、PPTX 设计预设与商务版式。可选 Microsoft Office COM 公式重算和渲染检查，条件不满足时明确标注未验证项。
- **Work 专属能力来源**：补齐 `WorkAgentSkill/` 全部 124 个物理来源入口，对应 104 个不同源正文 SHA 和 93 个名称，包含同名 PDF 技能的不同版本；历史副本可共享正文，不等于 124 个独立原创技能。另新增 PPT Master 与 ASD-STE100 适配。这些来源仅属于 WorkAgent，默认可发现，正文和参考按需加载。
- **更完整的代码工作流**：按需加载工程、前端、后端与数据、排障及验证技能；连续相同失败后要求调整策略，结合大工具输出分页读取、受控文件检查点、代码索引、LSP、测试、Lint 与类型检查完成验证。
- **可自行构建的 Skills 和插件**：内置 SkillCreator、PluginCreator 与 Harness 接口适配技能，提供本地开发市场、宿主校验及手动安装、启停、更新流程。CodeAgent 与 WorkAgent 同时支持能力自动发现和输入框“+ → 引用”手动选择，单扩展文件上限提高至 20,000。
- **最多十条自动消息队列**：运行中可预编辑后续消息和附件，上一任务正常完成后按加入顺序自动发送下一条；支持编辑和删除。停止、失败或重启后保留并暂停，恢复后从队首继续，主界面三种模式均可使用。
- **后台 SubAgent 协作**：移除固定十分钟总运行期限，主 Agent 派发子任务后可继续独立工作，再收集真实结果。子任务仍受完成状态、失败、用户停止、父任务取消及单次请求超时约束。
- **光轨工作台与快捷 Chat**：整理布局、信息密度、焦点态和状态动效，任务区支持调整高度与收起。默认 `Ctrl+M` 打开或收起聊天小窗，`Ctrl+Alt+L` 切换主界面与托盘；小窗支持置顶与十分钟会话续期，两项快捷键均可自定义并检测占用。修复警示图标撑高标题栏及输入时自行跳转格式预览的问题。

## 使用与升级

适用于 Windows 10/11 x64，支持简体中文和 English，需要配置自己的模型供应商与 API Key。CodeAgent、WorkAgent 和 ChatAgent 共用模型、上下文压缩等基础配置；ChatAgent 仅开放 `web_search`、`web_fetch` 和上传内容的只读解析，不提供任意本地路径读取、文件修改、命令、MCP、Skills 或子 Agent。

旧数据通过历史迁移升级至 schema 9，保留供应商、模型、会话、消息、草稿、归档、设置与凭据。Office 验证要求已安装且空闲的 Microsoft Office，并仅在受支持的 Work 主会话权限和执行环境中尝试；技能资源内置不代表第三方私有宿主接口或脚本自动可用。

Windows x64 安装文件为 `MingshenHarness-1.3.3-x64.exe`。同名 `.zip` 是封装安装程序的更新包，校验信息使用本次打包生成的 `.zip.sha256` 和 `.zip.json`。

完整变更与验证范围：

- [中文更新日志](https://github.com/SkyH1aa/MingshenHarness/blob/V1.3.3/docs/CHANGELOG.md)
- [使用手册](https://github.com/SkyH1aa/MingshenHarness/blob/V1.3.3/docs/USER_GUIDE.md)
- [1.3.3 验证记录](https://github.com/SkyH1aa/MingshenHarness/blob/V1.3.3/docs/VALIDATION_1.3.3.md)

## English Title

Mingshen Harness V1.3.3 | Code, Work and Chat Modes, Office Workflows and Automatic Queues

## English Introduction

Mingshen Harness 1.3.3 brings coding, office work and everyday conversations into three modes: CodeAgent, WorkAgent and ChatAgent. This release strengthens Office document creation and layout, engineering verification, Skills and local plugin development, while adding automatic queues for up to ten pending messages, background SubAgent collaboration, a pinned Quick Chat window and a refined Light Trails workbench.

## Highlights

- **Three Agent modes**: CodeAgent and WorkAgent share conversations, history and workspaces, with mode changes taking effect on the next turn after active work ends. ChatAgent has its own grouped conversations, search, rename, pinning and archive controls, plus web access and read-only questions about uploaded files.
- **Office workflows**: Edit selected DOCX content and paragraph layouts, create and edit structured XLSX workbooks, and make controlled text, table and notes changes to existing PPTX files. Design presets and presentation layouts support editable deliverables. Optional Office COM checks report recalculation and rendering separately, including anything that could not be verified.
- **Work-only capability sources**: All 124 physical sources in `WorkAgentSkill/` have mapped entries, including different versions of PDF skills. They map to 104 distinct source-body SHA values and 93 names; historical copies may share a body, so these are not 124 independently authored skills. PPT Master and ASD-STE100 adapters are also included. Entries are discoverable by default; instructions and references load on demand.
- **Engineering verification**: On-demand coding workflows, repeated-failure detection, bounded tool-output paging and controlled file checkpoints complement code indexing, LSP, tests, lint and type checks.
- **Local Skills and plugins**: Built-in SkillCreator, PluginCreator and Harness API skills guide development. A local marketplace supports host validation, manual installation, enable/disable and updates. CodeAgent and WorkAgent can discover capabilities automatically or select them through the composer. Each imported extension supports up to 20,000 files.
- **Automatic message queues**: Prepare up to ten pending messages with attachments while a task runs. After normal completion and cleanup, the next item starts in first-in, first-out order. Editing and deletion are supported; Stop, failures and application restarts preserve and pause the queue. Available in main-interface Code, Work and Chat conversations.
- **Background collaboration**: SubAgents no longer have a fixed ten-minute total lifetime. The main Agent can continue independent work before collecting results; cancellation, failures and individual request timeouts still apply.
- **Light Trails and Quick Chat**: Refined layout, task-panel resizing and collapse, focus states and state-driven motion. `Ctrl+M` toggles Quick Chat and `Ctrl+Alt+L` toggles the main window/tray by default. Quick Chat supports pinning and a renewable ten-minute session; both shortcuts can be recorded in Settings with registration-conflict detection. Header warning-icon alignment and unexpected composer-preview switching are fixed.

For Windows 10/11 x64, with Simplified Chinese and English interfaces. Bring your own model provider and API key. ChatAgent is limited to `web_search`, `web_fetch` and read-only uploaded content; it cannot access arbitrary local paths, modify files, run commands, load MCP/Skills or spawn SubAgents. Quick Chat and actual SubAgents do not have message queues.

Existing data upgrades through the permanent schema 9 migration. Office checks require an installed, idle Microsoft Office instance and a supported WorkAgent permission/execution environment. Third-party private host APIs and scripts are not enabled merely by bundling skill resources.

The Windows installer is `MingshenHarness-1.3.3-x64.exe`; the matching ZIP contains that installer for updates. Use the SHA-256 and byte size generated from the actual release package.

See the [English changelog](https://github.com/SkyH1aa/MingshenHarness/blob/V1.3.3/docs/CHANGELOG.en.md), [user guide](https://github.com/SkyH1aa/MingshenHarness/blob/V1.3.3/docs/USER_GUIDE.en.md) and [validation record](https://github.com/SkyH1aa/MingshenHarness/blob/V1.3.3/docs/VALIDATION_1.3.3.md) for details and tested boundaries.
