# Mingshen Harness 1.2.8 工作区升级验证

日期：2026-11-06（Asia/Shanghai）。本轮交付源码与已构建的实验版，未生成解包应用或 NSIS 安装包、未安装更新、未发布 GitHub/云端 SQL。所有桌面回归使用独立系统临时 profile、临时工作目录及本地 SSE 模型，没有读取或修改用户数据库、使用私人模型 Key。

## 本轮范围

- 单条 48px 自定义标题栏；专注对话、代码工作台、多任务协作三布局；按工作目录保存布局、左右面板宽度与开闭状态。拖动及键盘调整分隔线，窗口不足时使用互斥抽屉。
- 保留已确认原子图标、白色日间/石墨夜间、中英文；统一主要工作区的字号、分隔线、连续背景和短反馈动效。系统减少动态效果与应用内关闭均有效。
- 模型/Agent 控件集中到输入区，隔离及 patch-only 按需展开；计划区默认折叠，空计划不占聊天空间。协作布局显示任务树及子 Agent 输出。
- 右侧审查查看最新轮次保存的文件 diff 与命令/验证记录，与 Git 工作区范围分开；命令可停靠，浏览器使用剩余高度。保持已有文件、浏览器和执行能力。
- 六组设置导航覆盖原有 16 页，支持搜索直达。供应商使用列表/详情和连接、API Keys、模型标签；MCP 搜索/详情、定时任务筛选、轨迹按需展开、内置文档目录同步完成。
- 布局偏好通过 shared/preload/main 的类型化受限 IPC 写入现有 `app_settings` 的 `ui.preferences`。尺寸和项目数量规范化，读取失败不覆盖旧偏好，写入失败可见并可重试。SQLite schema 仍为 7，永久迁移不变；协议修订仍为 `2026-11-04.3`，无新增云端收集。

## 源码和资源检查

| 命令 | 实际结果 |
| --- | --- |
| `pnpm test` | 最终全量 70 文件通过、3 文件跳过；408 项通过、9 项外部环境测试跳过，24.45 秒 |
| `pnpm typecheck` | main/Node 与 renderer 两套 TypeScript 通过 |
| `pnpm lint` | Biome 209 文件通过 |
| `pnpm build` | main 75 模块、preload 3 模块、renderer 2111 模块生产构建通过；最终 `out` 包含本轮修正 |
| `pnpm audit --prod` | 检查时无已知生产依赖漏洞 |
| `node --test scripts/package-paths.test.cjs scripts/package-runtime-copy.test.cjs scripts/package-native-copy.test.cjs scripts/prepare-experimental-runtime.test.cjs` | 14 项通过，含实际 Windows 复制 API、路径限制、哈希和实验 EXE 修复 |
| `./package-win.cmd --check` | 24 项资源、生产依赖、离线 OCR/原生绑定、图标与 1.2.8 文档版本预检通过 |

9 项跳过分别依赖 GitHub、技能市场、MCP、BrowserDo、原生沙箱、Docker 或文档隔离的显式环境开关。它们不记作本轮实际联网/隔离验收；BrowserDo/Embiody 按用户既有要求不做真实调用。

## 真实 Electron 回归

GUI 脚本顺序运行，避免端口、焦点、通知与角标干扰。除下面单独说明的公开 HTTPS 和 Windows 通知，模型与授权服务使用本地夹具。部分脚本文件名保留最初引入版本，但本轮均针对当前 1.2.8 构建执行。

| 脚本 | 通过范围 |
| --- | --- |
| `settings-focus-smoke.mjs` | 10 组，连续输入、中文合成、刷新、光标/选区、Key 与模型保存 |
| `desktop-smoke.mjs` | 21 组，首次协议/手册、工具写入审批、diff、错误、浏览器、停止及双语 |
| `chat-scroll-smoke.mjs` | 19 项、160 段输出；上滑暂停、单按钮恢复、流式思考、键盘及完成后阅读；最后滚动修正后重跑通过 |
| `question-nav-smoke.mjs` | 13 组，119 条历史问题、悬停/点击/键盘、工作面板及阅读位置 |
| `approval-recovery-smoke.mjs` | 6 组，等待审批/提问恢复、提交延迟、旧回执和并发状态 |
| `agent-questions-smoke.mjs` | 9 组，三种模型协议、单/多选与 Other、错误和双语 |
| `agent-selection-smoke.mjs` | 9 组、8 次本地请求，全部内置/自建已启用 Agent 及只读配置 |
| `conversation-actions-smoke.mjs` | 11 组，分支、斜杠菜单、手动压缩、重命名/归档等 |
| `compaction-smoke.mjs` | 9 组，12 次摘要/18 次聊天，85% 阈值、主备模型、停止与恢复 |
| `context-restore-smoke.mjs` | 6 组，启动/重载/模型切换后的上下文恢复 |
| `v125-smoke.mjs` | 8 组，长菜单滚动/选择及首次同意与手册流程 |
| `v126-workbench-smoke.mjs` | 15 组、42 次本地请求；四个实际 worker、并发峰值 2；索引、七种原生 grammar、批量审批、真实测试失败后修复、计划断点、写入冲突、恢复与分页 |
| `task-workbench-ui-smoke.mjs` | 4 组、8 次本地请求、两个实际子任务；输出预览/折叠/名称跳转、停止重启续跑及双语紧凑布局 |
| `v127-plan-attachments-smoke.mjs` | 7 组、15 次本地请求，计划判断/清理/保留和附件 |
| `document-vision-smoke.mjs` | 8 组、7 次本地请求，原生 PDF 请求、页面图像、中英文 OCR、DOC/DOCX、重启及取消 |
| `approval-notification-smoke.mjs` | 6 组，真实 Windows COM 通知批准/拒绝回调、过期请求和设置 |
| `update-zip-smoke.mjs` | 7 组，公开 GitHub HTTPS 传输、校验/取消/等待；真实应用退出和 DB 关闭后启动无副作用 EXE 探针，没有安装软件 |
| `v128-workbench-smoke.mjs` | 最终 14 组，新版布局、焦点、持久化、截图矩阵、长记录及文档目录，见下节 |

`scripts/v128-regression.mjs` 可按给定名称顺序运行桌面脚本。新版专项使用 renderer CDP 9381 / main inspector 9382，其他脚本保留各自端口；不要与另一个 GUI 验证同时运行。

## 新版专项与性能

- 确认标题栏仅一条且为 48px，模型入口唯一；无计划时聊天不留空任务栏。
- 三布局切换保持同一个 composer DOM 及中文草稿、同一个编辑器 DOM 及未保存内容；不重新发送任务。指针真实拖拽右区从 460px 到 496px，经 IPC 持久保存。
- 设置六组导航和搜索直达；API Key 编辑器按字符输入中文/英文并跨后台刷新，焦点持续留在原输入框。全部 16 设置页及 MCP 详情/定时创建表单检查横向边界。
- 布局、面板尺寸、计划和关闭动态效果偏好在 renderer reload 后恢复；关闭动效后计算样式为 `0s`。本地流式正文和思考实际完成，无未捕获 renderer 异常。
- 临时 SQLite 建立 10,000 条可搜索会话、8 条子任务状态和 1,002 条轨迹事件；默认只绘制 3 条会话行。20 次分页搜索包含真实 IPC/SQLite，最后一轮 P95 **65.7ms**；这是开发机夹具测量，不是所有设备的性能承诺。
- 23 次布局操作到 DOM 状态可见的测量为 **4–14ms**。这是自动化 DOM 反馈时间，不等于 Windows 端到端输入延迟。
- 8 个子任务状态是确定性的界面夹具；真实并发执行另由工作台回归的四个 worker/峰值 2 验证，不宣称实测八 worker 同时执行。
- 保存的最新轮次 diff 和 1,000 条命令在重载后恢复；命令每批 100 条，轨迹事件/摘要按需挂载，摘要独立折叠，长内容在自身区域内滚动。
- 内嵌手册与日志目录可定位章节，正文独立滚动。

## 截图复核与已修正问题

主矩阵为三布局 × 两主题 × 中英文 × 1440×900/1024×640，共 24 张；紧凑矩阵使用 1.25 device pixel scale。另检查 1366×768、1920×1080（1.5）、2560×1080（2）及 800×600 的主区域边界。CDP 改尺寸后显式发送 resize 以触发 Electron 页面布局；这不等同于整套 Windows 100%–200% 实际系统 DPI 矩阵。

复核图保存在忽略的本地 `.impeccable/review/v128-*.png`，`v128-review-sheets.cjs` 生成布局/设置联系表方便逐项对照。截图内容均为临时夹具，不作为正式产品数据分发。

实际修正包括：右抽屉继承 grid 定位导致窄窗口越界；MCP 列表 action 与名称重叠；冗长 Agent 卡片；轨迹一次挂载全部重复摘要；审查 diff 的重复外框；空会话占位内容被自动跟随滚到图标下方；轨迹导出异常未就地展示。已重建并复验相关场景。历史的失败截图不作为最终通过证据。

设计技能要求的独立文档/收尾审查委派各尝试一次并重试，均被上游 `unsupported_encrypted_agent_content` 拒绝，未产生独立审查结果。主会话按降级清单复核并完成文档；不可写成“独立审查通过”。最终修正清单复评分为 resolved，`ship` 仅指这些列明 UI 修正可交付实验版，不代表全产品零缺陷认证。

## 文档、兼容与交付边界

README、DESIGN、AGENT/AGENTS、中英文手册和更新日志、SDK/启动及打包元数据同步 1.2.8。十份内嵌文档版本预检通过；三协议只更新当前适用版本，无新增数据处理或实质条款，无须因单纯 UI 升级再次同意。长期迁移、凭据保护、权限/隔离规则保持原实现。

未进行 NSIS 生成/安装/卸载、正式更新安装、真实付费模型语义质量、GitHub/Notion/Browserbase 账户端到端授权或企业策略矩阵验收；未开展用户访谈/六项任务的内测可用性研究。浏览器/MCP 既有能力的源码和本地流程回归不能替代所有外部服务实测；没有第三方安全认证或“没有任何 Bug”的保证。

实验入口（最终生产构建已完成）：

```powershell
cd C:\Users\ASUS\Documents\ChatGPT\MingshenHarness
.\run-experimental.cmd
```

后续源码修改先 `pnpm build` 再启动。自行生成安装包仍使用根目录 `./package-win.cmd`；本轮仅核对材料，没有执行该安装包命令。
