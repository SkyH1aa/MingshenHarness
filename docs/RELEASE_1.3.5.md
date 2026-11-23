# Mingshen Harness 1.3.5

> 发布状态：1.3.5 正式包已生成。ZIP大小、SHA-256及本地 sidecar/JSON 已核对；远端 GitHub ZIP 未重新下载。发布 SQL 已生成，需在已部署 `0003_zip_updates.sql` 的 Supabase SQL Editor 手动执行；本页不代表云端发布已完成或正式安装器已验收。

## 中文标题

**Mingshen Harness 1.3.5：简约主题与桌面体验升级**

## 中文简介

Mingshen Harness 1.3.5 收紧默认简约主题的工作区层级、留白、焦点反馈和空状态布局，并提供覆盖主屏、可跳过的原子标识启动展示与可选桌宠。桌宠默认关闭，内置 36 段由用户角色视频处理的透明动作，透明边缘颜色经过优化以降低视频编码串色，并支持任务状态、互动、休息及右键菜单；窗口可拖动、置顶并调整尺寸和透明度。高倍检查仍可能看到细微暖边，素材处理不保证无损。闲聊只使用内置本地短句，不调用语言模型或联网；桌宠提示不展示任务正文。启动展示、桌宠和现有 CodeAgent、WorkAgent、ChatAgent 能力共用原有本地数据与权限边界，不改变数据库 schema、协议修订号或原子应用图标。

## 中文亮点

- **本地插件工作流**：修复插件创建技能的入口和引用资源加载问题；设置支持逐项校验市场根目录。启用插件默认可按需发现并在本轮激活，支持逐次模型请求的 prompt-only 扩展钩子；市场更新检查只读执行，用户确认后才更新。
- **联网请求**：`web_search` 和 `web_fetch` 使用 90 秒单次请求预算，并明确区分取消、超时和网页服务错误。
- **简约主题**：收紧标题栏、会话列表、工作区和输入区的层级与留白；没有计划或子任务时不显示大块空任务占位。
- **启动展示**：现有原子标识与轨道在置顶主屏窗口中呈现，按真实启动阶段更新；正常显示且主窗口就绪时约 5 秒，默认开启，可关闭或跳过，异常或约 8 秒兜底不阻塞主窗口。已同意协议的用户在展示期间可选预热有限的会话索引，不读正文或密钥，也不保证提速；首次协议阅读计时在展示结束和主窗口显示后开始。
- **桌面宠物**：透明动作随任务与交互变化，透明边缘处理降低编码串色（仍可能残留细微暖边）；工作会话面板显示标题、状态和本地运行时长，可折叠或跳转会话；标题默认显示，可在设置中关闭。右键可打开快捷 Chat、点播动作及管理休息和显示；可调整或关闭待机趣味动作，并启用不影响真实任务和手动互动的免打扰。原始角色视频保留，抠像不承诺无损；除标题外不向桌宠传递会话正文、文件内容、工作目录路径、命令参数或审批详情。
- **Chat 会话批量管理**：可按搜索范围跨分组勾选或全选，批量归档、恢复和永久删除；归档与删除须确认，删除前先停止任务，失败项保留供重试。
- **安装资源**：保留现有原子应用图标，并加入 Windows 安装流程使用的品牌化头图、侧图和标识资源；安装欢迎页内嵌 `00–07` 共 8 帧原子动画并按定时器轮换。正式安装、升级与卸载需以实际构建后的 Windows 验收为准。
- **兼容性**：保留 1.3.4 的 CodeAgent/WorkAgent/ChatAgent、工作站、Skills、插件、队列、快捷 Chat、联网开关、Office 工具和权限/恢复闭环。

## 验证与发布材料

1. 源码级检查、类型检查、构建、资源预检及正式打包结果记录在 [1.3.5 验证记录](VALIDATION_1.3.5.md)。
2. 本地 ZIP 为 `378071417` 字节，SHA-256 为 `c7dec5c38ac1af95f737752bd44f82e0605b00fa0e8f736290665e971e9620e1`，与本地 `.zip.sha256` 和 JSON 元数据一致。
3. 发布脚本见 [publish-release-1.3.5.sql](../supabase/publish-release-1.3.5.sql)。下载直链为 `https://github.com/SkyH1aa/MingshenHarness/releases/download/V1.3.5/MingshenHarness-1.3.5-x64.zip`；执行前确认该远端资产已上传且与本地 ZIP 相同，再于 Supabase SQL Editor 手动执行。不要在客户端执行 SQL。

## English title

**Mingshen Harness 1.3.5: Simple Theme and Desktop Experience**

## English summary

Mingshen Harness 1.3.5 tightens hierarchy, spacing, focus feedback and empty-state layout in the default Simple theme. It adds a skippable, primary-screen atom-mark startup presentation and an optional desktop companion. Disabled by default, the companion includes 36 transparent actions processed from the supplied character videos; transparent-edge colors are refined to reduce encoding bleed, though fine warm edges may remain. It also provides task states, interactions, rest and a context menu. Its window supports dragging, always-on-top, size and opacity. Idle chat uses built-in local phrases without calling a language model or the network, and task hints omit task content. Existing local-data and permission boundaries, the database schema, policy revision and application atom icon remain unchanged.

## English highlights

- **Local plugin workflow:** fixed built-in plugin-creation Skill entry and reference loading; Settings can validate every plugin under a marketplace root. Enabled plugins are discoverable and can be activated on demand for one run, with prompt-only context before each eligible model request. Read-only update checks require the user to confirm an update.
- **Web requests:** `web_search` and `web_fetch` use a 90-second per-call budget and distinguish cancellation, timeout and web-service errors.
- **Simple theme:** tighter titlebar, conversation, workspace and composer hierarchy; empty task bands collapse when no plan or child task exists.
- **Startup presentation:** a topmost primary-screen atom-mark window reports real startup stages. When displayed normally and the main window is ready, it lasts about five seconds. It is enabled by default, can be disabled or skipped, and closes on error or after an approximately eight-second fallback without blocking the main window. For users who have accepted the policies, a bounded set of conversation index pages may be warmed during the presentation without reading bodies or keys and without guaranteeing a speedup. First-use policy reading starts after the presentation ends and the main window is shown.
- **Desktop companion:** transparent actions respond to tasks and interaction, with refined edge colors to reduce encoding bleed; fine warm edges may remain. The collapsible working-conversations panel shows titles, states and local elapsed time and can open a conversation; titles are shown by default and can be disabled in settings. The menu provides Quick Chat, action previews, rest and display controls. Idle actions are adjustable or can be disabled, and quiet mode does not stop tasks or prevent manual interaction. Original character videos are retained; background removal is not guaranteed lossless. Other than titles, conversation bodies, file contents, workspace paths, command arguments and approval details are not sent to the companion.
- **Chat batch management:** select conversations across groups within the current search to archive, restore or permanently delete them. Archive and deletion require confirmation, deletion first stops tasks, and failed items remain available for retry.
- **Installer resources:** the existing atom application icon is retained, with branded header, sidebar and mark assets for the Windows installer flow; the welcome page embeds eight atom-animation frames, `00–07`, and rotates them on a timer. Formal install, upgrade and uninstall behavior still require runtime acceptance of the actual build.
- **Compatibility:** existing CodeAgent, WorkAgent and ChatAgent modes, workstations, Skills, plugins, queues, Quick Chat, internet control, Office tools and permission/recovery boundaries remain available.

## Verification and release materials

1. Source checks, type checks, the production build, resource preflight and formal package results are recorded in the [1.3.5 validation record](VALIDATION_1.3.5.md).
2. The local ZIP is `378071417` bytes with SHA-256 `c7dec5c38ac1af95f737752bd44f82e0605b00fa0e8f736290665e971e9620e1`, matching its local `.zip.sha256` file and JSON metadata.
3. The release script is [publish-release-1.3.5.sql](../supabase/publish-release-1.3.5.sql). Before executing it in the Supabase SQL Editor, confirm the remote asset has been uploaded and matches the local ZIP. Do not execute SQL from the client.
