# Mingshen Harness 1.3.4

> 发布状态：1.3.4 源码修复已集成，最终命令、通过项和未覆盖边界详见 [1.3.4 验证记录](VALIDATION_1.3.4.md)。本页不代表真实供应商、正式安装包或安装升级已经验收。

## 中文标题

**Mingshen Harness 1.3.4：创作工作面、项目协作与可靠性修复**

## 中文简介

Mingshen Harness 1.3.4 增加创作与生图工作面、只读 AutoDrive、多角色协作、交互式终端和逐行审阅，同时修复运行可靠性、项目边界、附件解析和 Office 文档处理，并为 ChatAgent 加入分组快速新建。模型流必须明确完成；项目配置、项目 Agent 与 LSP 受工作区信任边界约束；大附件和复杂 Office 文件进入有界解析与验证。CodeAgent、WorkAgent、Skills 与本地插件、自动队列、快捷 Chat 和现有权限边界继续保留。

## 中文亮点

- **运行中引导**：主 Code/Work/Chat 及快捷 Chat 可发送纯文字补充要求；当前模型回复和工具批次继续执行，在同一次运行的后续模型请求接入。等待接入、已接入及未应用状态清晰可见，失败保留草稿，下一轮队列继续处理独立的后续任务。
- **创作工作站**：780 个独立场景、65 种任务结构及 12 类，每项可选简略或详细版。默认中文详细提示词至少 800 汉字，包含场景专属内容、共享流程与执行规则及真实推荐技能；编辑后长度可能变化，字数不等于独创字数或质量验收。可组合分类、格式及多关键词搜索、预览和复制完整提示词。切换版本保留编辑，旧草稿兼容，支持撤销及 JSON 保存；交给 WorkAgent 只追加草稿，用户自行发送。
- **技能和侧栏**：同源技能按语义版本显示最新版，自动发现与手动引用统一保留 98 个活动来源，独立用途变体和 124 份物理溯源保留，旧选择兼容原权限。修复 Code/Work 左栏控制区异常占据大块空白的问题。
- **生图工作台**：用户自配 OpenAI Images 兼容的 Base64 图片模型，并独立选择文本/视觉模型；润色提示词先预览确认，图片反推要求视觉输入。支持本地素材、画布图层、PNG 和带素材的可移植工程，GIF 由所选图片帧合成，不是 AI 视频生成。
- **自动规划与协作**：AutoDrive 只读提出 3 至 5 个方向，选中方案只进入草稿；所选 worktree 尚未建立时需先在该会话运行任务建立，AutoDrive 不会创建或回退主目录。18 个内置 Agent 角色可用于协同总控拆分 2 至 6 个工作包并派发真实子任务；父任务可继续独立工作，质量状态取决于实际验证证据和命令，不能只凭 QA 文字认定通过。
- **搜索与终端**：`Ctrl+Shift+P` 搜索当前模式命令、会话与工作区文件；项目分支/worktree 未实际记录时保持未知。用户操作的多标签交互 Shell 只开放给主窗口的可信 Code/Work 项目，要求完全访问、非仅补丁，以及宿主或实际 worktree 执行；清理未确认时保留错误与重试状态。
- **审阅与草稿**：Git、分支、会话和上一轮四种 diff 范围支持行号评论；核对未变化后只追加草稿，不自动发送。可配置独立草稿润色模型，预览后显式应用，另有单次临时指令和按工作区保存的项目语气，均不扩大权限。
- **DeepSeek 工具链**：修复 thinking 开启时，受控工具链的合成步骤缺少供应商续接状态而可能返回 HTTP 400 的问题。本地历史仍保留内部执行步骤，发往 DeepSeek Chat 的历史会折叠回原始链根结果。
- **Memory 摘要**：原生 Memory 不再用推理内容可能耗尽的固定小预算限制任务摘要，同时继续拒绝截断、取消或失败产生的半摘要。
- **沙箱停止**：进程终止失败或目标未关闭时不再无限等待；无法确认清理结果时保留工作区写入屏障和资源租约，不回退到宿主执行。
- **目录同步**：实时会话事件漏达后，增量 revision 不再使未知的新建或删除记录永久无法补回；历史数据不会被静默清空。
- **恢复路径**：收紧快照和 Git 恢复在验证与实际 I/O 之间的目录重解析窗口，继续要求用户主动恢复并拒绝工作区外路径。
- **缓存与命令生命周期**：移除无人读取的去重缓存写入；持久命令在清理确认成功后释放旧错误和名额，未确认清理仍保留安全保护。
- **退出与中断恢复**：退出时每项服务清理都会结算后才关闭存储；中断恢复重新检查真实证据、工作区屏障和活动写入，用户确认后才释放恢复屏障与租约。
- **Chat 分组快速新建**：分组与未分组标题增加直接新建入口，顶部加号及空态按钮也不再弹出完整表单。新对话继承该组最近更新的未归档 Chat 的供应商、模型、推理等级与聊天设置，历史、草稿和附件保持独立；空组回退最近未归档 Chat，首次使用采用可用文本模型。来源失效时明确提示修复，创建期间防止重复点击。
- **ChatAgent 联网开关**：输入区可按会话允许或禁止网页搜索与读取。允许后不再逐次审批，禁用后工具不可见且由主进程强制拒绝；模型供应商连接和附件发送不受此开关影响，基于已有 Chat 的新会话与分支会保留禁网状态。
- **输入与流完整性**：粘贴、键入、输入法或快捷键不再自行跳到格式预览；只有手动点击才进入预览，草稿恢复时保留用户上次的原文/预览选择。Chat Completions 缺少正式 `finish_reason` 时按截断失败处理，截断流中的工具调用不会执行。
- **附件与项目边界**：每条消息最多 10 个附件、单文件 25 MiB、合计 50 MiB，并在读取文件字节前预检。项目 JSON、Markdown Agent 与 `{file:...}` 只从已信任工作区加载，项目 Profile 不覆盖主 Agent；LSP 不能读取工作区外文件。取消宿主命令和启动失败均有有界清理。
- **Office 与文档防护**：文档解析进入有界 worker；ZIP、XML、文本和图片输入增加完整性限制。Excel 请求共享 100,000 单元格工作量预算，拒绝危险公式与外部引用，嵌入工作簿有递归、数量和解压预算；验证结果明确区分结构、公式重算和页面渲染。宿主文档覆盖采用受控提交与失败恢复，取消或超时会保留备份并明确报错；Windows 分步重命名之间仍有极短 gap，不宣称断电级无间隙原子覆盖。
- **扩展和本地服务**：MCP OAuth 拒绝凭据重定向并正确合并密钥；本地浏览器预览绑定会话工作区；ACP 处理失败/中断，并给取消 abort 设置有界等待，失败或超时会清理本地 waiter 并报告远端停止未确认；无头 API 使用正常校验；实验入口每次先构建当前源码；插件市场清单使用跨进程锁与原子替换，避免并发更新丢失。

## English title

**Mingshen Harness 1.3.4: Creative Workspaces, Project Collaboration and Reliability**

## English summary

Mingshen Harness 1.3.4 adds creative and image workspaces, read-only AutoDrive, multi-role coordination, an interactive terminal and line review while hardening runtime reliability, project boundaries, attachments and Office authoring. ChatAgent also gains direct quick creation in groups. Model streams require an explicit terminal reason, workspace trust limits project configuration and LSP, and complex attachments and Office files use bounded processing and explicit verification states. CodeAgent, WorkAgent, Skills and local plugins, automatic queues, Quick Chat and existing permission boundaries remain in place.

## English highlights

- **In-run guidance:** primary Code/Work/Chat conversations and Quick Chat accept plain-text updates without cancelling the current response or tool batch. Updates join a subsequent model request in the same run, with explicit waiting, included and not-applied states and draft preservation on failure. The next-turn queue continues to handle separate later tasks.
- **Creative workstation:** 780 distinct scenarios across 65 task structures and 12 categories, each with brief and detailed versions. Default Chinese detailed prompts contain at least 800 Han characters, combining scenario-specific content with shared workflows and execution rules, plus real Skill recommendations. Editing can change length; the count does not mean 800 characters are independently authored for each scenario or guarantee quality. Combine category, format and multi-keyword filters, preview and copy the complete prompt. Switching preserves edits, supports old drafts, undo and JSON persistence; WorkAgent handoff only appends a draft for the user to send.
- **Skills and sidebar:** discovery and manual selection share the latest semantic version of matching source Skills, exposing 98 active entries while retaining independent variants and all 124 physical provenance records. Old selections retain permission checks. Fixed oversized empty control space in the Code/Work sidebar.
- **Image Studio:** configure an OpenAI Images-compatible Base64 image model and a separate text/vision model. Preview and approve polished prompts; image-to-prompt requires vision input. Use local assets, canvas layers, PNG and portable project bundles with assets. GIFs assemble selected image frames and are not AI video generation.
- **AutoDrive and coordination:** read-only AutoDrive proposes three to five directions and appends the selected proposal only to the draft. If the selected worktree is not established, a task in that conversation must establish it first; AutoDrive does not create one or fall back to the main directory. The 18 built-in Agent roles support a coordinator dispatching two to six real work packages while the parent continues independent work. QA depends on actual verification evidence and commands, not a textual claim alone.
- **Search and terminal:** `Ctrl+Shift+P` searches commands available in the current mode, conversations and workspace files; branch/worktree attribution stays unknown without an established session record. The user-operated multi-tab Shell is limited to trusted Code/Work projects in the main window, with Full Access, patch-only off and host execution or an actual worktree; unconfirmed cleanup retains an error and retry state.
- **Review and drafting:** Git, branch, session and previous-turn diff scopes support numbered line comments. After rechecking the file and diff, comments append to the draft without sending. Configure an independent draft-polish model and explicitly apply its preview, plus a one-turn instruction and workspace tone; none expands permissions.
- **DeepSeek tool chains:** thinking-enabled controlled chains retain local execution steps while folding them back into the original chain-root result for DeepSeek Chat requests, so synthetic call/result pairs without provider continuation state are not sent as independent history.
- **Memory summaries:** native Memory summaries use a recovery-safe output budget and still refuse partial or truncated results after cancellation, timeout or failure.
- **Sandbox termination:** stop handling now settles within a hard bound. Unconfirmed process-tree cleanup retains the write barrier and leases and never falls back to the host.
- **Catalog recovery:** a missed live event can no longer make an unknown conversation permanently unreachable after the delta revision advances.
- **Restore paths:** snapshot and Git restore validation is tied more closely to the actual host operation, reducing ancestor-reparse races without weakening static link or workspace-boundary checks.
- **Cache and command lifecycle:** deduplication no longer fills the LRU with unread entries, and confirmed persistent-command cleanup releases stale errors and capacity while unconfirmed cleanup remains protected.
- **Shutdown and recovery lifecycle:** service shutdown settles every cleanup step before closing storage; interrupted recovery rechecks evidence, workspace barriers and active writers, and releases leases only after explicit user confirmation.
- **Quick chats in groups:** group and Ungrouped headings, the top plus and the empty-state action create directly without a full setup dialog. A new chat inherits provider, model, reasoning and chat settings from the group's most recently updated non-archived Chat while keeping history, drafts and attachments separate. Empty groups fall back to the latest non-archived Chat, and first use selects an available text model. Invalid source settings produce a visible error, and creation controls prevent duplicate clicks.
- **ChatAgent internet control:** the composer can enable or block web search and webpage fetch per conversation. Allowed calls no longer request approval each time; blocked tools are hidden from the model and enforced by the main process. The control does not block model-provider connections or attachment submission, and new chats/forks based on a blocked Chat preserve that state.
- **Composer and stream integrity:** paste, typing, IME and shortcuts no longer switch to formatted preview; only the explicit preview control does, while restored drafts retain the user's prior source/preview choice. Chat Completions without a provider-issued `finish_reason` fails as truncated, and tools from that incomplete stream are not executed.
- **Attachments and project boundaries:** each message accepts at most 10 attachments, 25 MiB per file and 50 MiB total with pre-read validation. Project JSON, Markdown Agents and `{file:...}` load only from trusted workspaces, project Profiles do not replace primary, and LSP cannot escape the workspace. Host-command cancellation and startup failure use bounded cleanup.
- **Office and attachment hardening:** document parsing runs in bounded workers with ZIP, XML, text and image-integrity limits. Excel requests share a 100,000-cell work budget, reject active/external formulas and bound embedded workbooks by recursion, count and decompression budgets. Host document replacement uses controlled commit and failure recovery with an explicit backup on cancellation or timeout; a short gap remains between Windows rename steps and no power-loss, gap-free atomic guarantee is claimed. Verification separates package structure, formula recalculation and rendered output.
- **Extensions and local services:** MCP OAuth refuses credential-forwarding redirects and merges declared keys safely; embedded local preview is bound to the session workspace; ACP settles failure/interruption and bounds cancellation abort requests, rejecting the active prompt and clearing the local waiter as “remote stop is not confirmed” on HTTP failure, network error or timeout; the headless API reuses normal validation; the experimental launcher builds current source on every run; plugin marketplace updates use a cross-process lock and atomic replacement so concurrent writes are not silently lost.

## 升级说明

- 源码与实验版版本号统一为 `1.3.4`；schema、政策修订号、原子图标和用户数据目录不因本版本变更。
- 1.3.3 的安装包、ZIP、SHA-256、大小、发布 SQL 和验证记录均属于历史材料，不能改名或复用为 1.3.4。
- 正式发布前必须重新构建，并核对新 ZIP 的 SHA-256、字节数、内部安装器版本和发布直链。
- 当前验证范围、实际命令和未覆盖边界见 [1.3.4 验证记录](VALIDATION_1.3.4.md)。
- 稳定性修复阶段全量回归和 Chat 快速新建的定向测试属于较早阶段证据，不能替代本轮新增修复的最终集成结果；本轮最终命令、数字与失败重跑以 [1.3.4 验证记录](VALIDATION_1.3.4.md) 为准，不在本页重复或累加。真实供应商、Office COM、Docker/MXC 和 NSIS 安装升级仍需单独验收。
