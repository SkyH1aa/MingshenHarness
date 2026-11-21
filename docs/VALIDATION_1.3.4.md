# Mingshen Harness 1.3.4 验证记录

最近核对日期：2026-11-20（Asia/Shanghai）。目标版本：1.3.4。

状态：**全仓审查清单修复、粘贴原文修复与ChatAgent联网开关已完成代码集成验证**。本记录先按迭代保存全仓审查的155文件、2115项结果；后续联网控制补丁的最终完整串行Vitest为155文件、2121项通过，另有3文件、14项按环境条件跳过，详见末尾本轮追加部分。类型检查、Lint、构建及打包资源预检通过；完整工作台smoke有一项任务面板复载断言超时，联网专项Electron smoke单独通过。以下按阶段保留证据，不把早期数字当作最新结果；1.3.3及更早记录仅作历史基线。

## 稳定性修复范围（2026-11-19）

| 编号 | 已核对问题 | 必须覆盖的回归边界 |
| --- | --- | --- |
| 1 | DeepSeek thinking + `execute_tool_chain` 合成工具步骤缺少供应商续接状态 | 真实请求体、工具 call/result 配对、原始状态保留、无伪造推理、其他协议不回归 |
| 2 | 原生 Memory 摘要的 512 token 预算可能被推理耗尽 | 强制推理、小输出上限、截止时间、取消、截断失败不写入、TencentDB 分支隔离 |
| 3 | 原生沙箱 `taskkill` 失败或目标无 `close` 时 Promise 无期限 pending | `taskkill` 拒绝、目标永不关闭、迟到关闭、取消、超时、监听与句柄清理、未确认屏障保留 |
| 4 | 未加载会话 ID 的 delta 在 revision 推进后无法补回 | 新建、子会话、删除、升入可见范围、分页游标、Code/Work/Chat 目录隔离、事件漏达恢复 |
| 5 | `safeFilePath` 校验后祖先目录可被重解析的 TOCTOU 风险 | 快照恢复、Git 恢复、静态链接拒绝、工作区外路径拒绝、并发替换、失败时源/备份/index 安全 |
| 6 | `deduplicate()` 写入 generation 前缀但无人读取的 LRU 条目 | 并发合并、失败清理、`clear()` generation 隔离、容量不挤出有效项、外部修改后重读 |
| 7 | 持久命令成功后仍保留旧 `cleanupError` 并最终耗尽 64 个名额 | 先失败后确认清理、真正未确认仍保留、部分 `cancelRun` 失败、stop/poll 并发、容量恢复 |
| 8 | 退出时某个服务停止失败会短路后续清理 | Chat、调度、Browser、MCP、队列、Guarded I/O、插件旧版本和数据库均完成结算，错误聚合后可见 |
| 9 | 中断恢复可能在未确认进程、工作区屏障或并发写入时提前放行 | evidence、barrier、活动运行和写入租约重新检查；用户确认后才清理命令记录、tombstone 与 lease |
| 10 | Native Sandbox 恢复检查边界过宽或 cleanup tombstone 被误清除 | 只读 recovery inspection 仅允许固定读操作；写入/命令/status 继续受屏障保护，未确认记录不因 TTL 消失 |
| 11 | 句柄级工作区 I/O、Git/快照恢复仍可能遇到 reparse、junction 或硬链接逃逸 | 逐级句柄校验、静态链接拒绝、NTFS 硬链接拒绝、临时文件 Flush/SHA 校验后原子替换及受控 index 恢复 |

## 验证命令

以下命令在稳定性修复阶段的最终代码集成后执行。

```powershell
# apps/desktop
node ../../node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism

# 仓库根目录
pnpm typecheck
pnpm lint
pnpm build
.\package-win.cmd --check
git diff --check
```

## 实际结果

### 稳定性修复阶段结果

- 完整串行 Vitest：**150 个文件通过、3 个跳过；2001 项通过、14 项跳过**，退出码 0，用时 243.95 秒。覆盖 DeepSeek 链续接、Memory 摘要、沙箱停止/恢复、会话目录同步、Guarded I/O、Git/快照、缓存、持久命令、退出清理和 Chat/Workbench 回归。
- `pnpm typecheck`：Node 与 Web 两套 TypeScript 检查通过。
- `pnpm lint`：Biome **389 个文件**通过，无自动修改。
- `pnpm build`：通过；TencentDB 固定源 **25** 个模块校验通过，生成 main **1,714.86 kB**、preload **31.47 kB**、renderer JS **2,581.92 kB**、CSS **365.61 kB**。
- `.\package-win.cmd --check`：最终构建后再次执行，退出码 0，**13,865 项资源、生产依赖及版本 1.3.4** 通过；这是源码预检，不是正式安装包验收。
- `git diff --check`：通过。
- 文档收尾：Marked 解析 **8 份文档**通过，**149 个本地链接目标**均存在，无 NUL；只读进程检查未发现本轮 Vitest、Git 或 taskkill 残留。

### 逐项回归证据

| 修复 | 关键测试与检查 |
| --- | --- |
| DeepSeek 链续接 | `decision-memory-runtime.test.ts` 的 `collapses execution-chain steps into a valid DeepSeek thinking tool history` 实际从 ChatService 执行两步读取并检查第二轮请求；`provider-native-state.test.ts`、`model-stream.test.ts` 覆盖真实原生状态优先、默认/禁用思考和其他协议 |
| Memory 预算与提交 | `decision-memory-runtime.test.ts` 覆盖推理耗尽后扩大预算、小模型预算、关闭 Memory 和运行取消；`project-memory-service.test.ts` 覆盖排队期间关闭/切换/超时/取消及原子提交前再次校验 |
| 沙箱有界停止 | `native-sandbox-run.test.ts` 覆盖 taskkill 失败/永不返回、目标无 close、迟到 close、输出上限、准备阶段取消及 scoped tombstone；`tool-registry-native-cleanup.test.ts` 检查 typed 错误和真实清理调用 |
| 会话增量恢复 | `session-catalog.test.ts` 与 `session-catalog-sync.test.ts` 覆盖未知 ID、新根/子会话、分页、模式隔离以及 bootstrap 和 delta 之间新增根会话时只推进已应用 revision |
| 文件路径与恢复 | `guarded-workspace-io.test.ts`、`snapshot-service.test.ts`、`git-change-service.test.ts` 覆盖 junction/硬链接拒绝、句柄固定祖先、原子覆盖、取消/停止 epoch、Git filters 超时和快照/Git 恢复 |
| 工具缓存 | `tool-cache-index.test.ts` 的 `uses deduplication only for in-flight reads without evicting verified content entries` 和 `isolates cleared in-flight reads and retries failed reads` 覆盖 LRU 容量、generation 隔离和失败后重读 |
| 持久命令 | `persistent-command-service.test.ts` 覆盖旧 cleanupError 成功后清除、停止重试、真实未确认记录保留、迟到 close/cleanup、活动命令原子拒绝以及只清理指定 run |
| 退出和恢复 | `app-services-shutdown.test.ts` 覆盖某服务、Guarded I/O 或插件失败后仍关闭数据库并聚合错误；`workbench-runtime.test.ts`、`document-authoring-runtime.test.ts` 检查未确认清理保留 lease/barrier、真实检查及用户确认后才释放 |

第一轮完整测试有一个最小沙箱替身缺少新 `confirmRunStopped()` 接口而失败；最终补齐替身并断言真实调用了恢复确认，没有把生产接口变为可选或跳过真实确认。之后完整套件、类型检查及 Biome 重新执行通过。其他定向运行与完整套件覆盖有交集，不将测试数字累加。

本轮没有调用真实 DeepSeek、Gemini、Anthropic 或其他付费供应商，没有启动真实 MXC、Docker、Office COM、NSIS 安装/卸载/升级或正式 Electron 安装包，也没有执行云 SQL、访问正常用户数据库/API Key、提交或推送。定向测试使用本地 fixture；真实供应商续接、隔离运行时差异、Office 公式重算/渲染及 Windows 安装升级仍需在具备相应环境时单独验收。

多文件 Git 撤销和快照恢复仍不是数据库级事务；若外部进程在操作中途并发修改工作区，操作可能部分完成，但会报告失败并保留安全快照。原生沙箱也不能约束已经脱离受管会话的系统级 daemon。

## ChatAgent 分组快速新建（2026-11-20）

### 实现与回归范围

- 主进程新增 `createChatSessionInGroup(groupId: string | null)`，从同组最近更新的未归档 Chat 根会话继承供应商、模型、推理等级、系统提示和压缩模型。空组回退最近更新的未归档 Chat；完全没有未归档 Chat 根会话时选择首个已启用文本模型。来源按更新时间选择，不按置顶显示顺序选择。
- 新对话不复制历史、草稿、附件、扩展或运行状态，保持 ChatAgent 独立页面、无工作目录和受限工具边界。分组不存在、来源模型失效或推理等级不兼容时明确失败，不静默跳到旧来源；QuickChat 白名单不开放此新 IPC。
- 侧栏顶部、分组及未分组加号、Chat 空态均直接创建并选中空白对话，删除旧完整新建弹窗。分组创建后展开并清除搜索；异步创建期间禁用入口并防连点，窄屏失败会打开侧栏抽屉展示错误。长组名保留完整 title，创建、重命名和删除各使用独立 32px 控件。
- README、双语内嵌使用手册和更新日志、DESIGN、Release 与交接记录同步。旧 Agent 模式和光轨工作台 smoke 更新为无弹窗流程，但本轮只运行新建专项，没有重跑这两份脚本的全部场景。

### 实际命令

```powershell
# apps/desktop
node ../../node_modules/vitest/vitest.mjs run src/main/sessions/session-service.test.ts src/main/sessions/session-catalog.test.ts src/main/desktop/quick-chat-controller.test.ts src/renderer/src/lib/session-catalog-sync.test.ts --maxWorkers=1 --no-file-parallelism

# 仓库根目录
pnpm typecheck
pnpm lint
pnpm build
node scripts/chat-group-create-smoke.mjs
.\package-win.cmd --check
```

### 最终结果

- 定向 Vitest：**4 个文件、37 项通过**，退出码 0，用时 **2.60 秒**。新增覆盖同组来源、空组/首次回退、归档排除、独立内容、失效配置不回退及 QuickChat 拒绝接口。
- TypeScript Node/Web 检查通过；Biome **388 个文件**通过，无自动修改。
- 生产构建通过；TencentDB 固定源 **25** 模块一致，main **137**、preload **3**、renderer **2254** 模块；产物为 main **1,717.71 kB**、preload **31.64 kB**、renderer JS **2,578.96 kB**、CSS **365.20 kB**。renderer 入口为 `index-DvFymHUX.js` 和 `index-9s72hnjt.css`。
- 真实 Electron 专项：**10/10 场景通过、17 张截图，0 次模型/fixture 网络请求、0 renderer 异常、0 fixture 服务错误**。证据为 `.impeccable/review/v134-chat-group-create-1795095868403/result.json`，截图位于同目录且已逐张查看。
- 桌面专项覆盖简约/光轨、中英文、日夜、1440/800 抽屉、长组名和独立操作、配置继承及草稿/附件隔离、搜索/折叠复位、防重复创建、失效错误和修复后重试。独立临时 profile 已清理，测试 Electron 已退出。
- 资源预检退出码 0：**13,865 项资源、生产依赖及版本 1.3.4** 通过。机械设计检测仅报告共享 CSS 的 10 条既有建议，没有为消除建议改动其他界面。
- 文档收尾：**10 份 Markdown** 可解析，**157 个本地链接目标**存在且无 NUL；三处应用版本均为 1.3.4，renderer 入口与最终构建一致。差异空白检查通过，只读检查未发现本轮桌面专项或其临时 profile 进程残留。

本轮未重跑完整后端套件；上方稳定性阶段的2001项属于此前全量回归，不与本轮37项相加。没有向真实模型发送消息，没有访问正常用户 profile、数据库或 API Key，也没有生成正式 NSIS/ZIP、安装升级、云端写入、提交或推送。桌面专项覆盖 Chromium 视口几何，不代表完整 Windows DPI 和辅助技术矩阵验收。

## 全仓审查问题修复（2026-11-20）

用户要求修复审查清单中的运行、数据保护和信任边界问题，并确认复制内容后自动跳到格式预览的行为；应用版本继续为1.3.4。下面记录修复合同、关键回归点及本轮最终结果。

| 问题 | 修复与回归重点 |
| --- | --- |
| 项目 Agent 配置及 `{file:...}` 越界引用 | 项目来源只在已信任工作区同步；内置 Profile 不被源文件覆盖；工作区内引用经过有界、句柄级读取；跨项目及撤信任的来源失效 |
| LSP 读取工作区外文件 | Chat 调度与 LSP 服务双层路径限制；打开文件使用有界受保护读取；返回位置元数据不授权读取文件 |
| 截断 Chat Completions 被视为成功 | 必须收到正式 `finish_reason`；仅 `[DONE]`、非空文本或完整工具片段不够；失败不放行工具执行 |
| 编辑/重试准备失败丢失历史 | 接受前完成校验和准备；尾部替换、草稿消费及相关状态清理在事务内提交，持久化失败回滚 |
| 附件数量和累计容量 | 每条最多 10 个、单文件 25 MiB、合计 50 MiB；文件读取/编码前 Renderer 预检，主进程、草稿和队列再次验证 |
| Office 附件阻塞主进程、ZIP 膨胀 | 文档提取统一使用最多 2 个 worker、384 MB 堆及 180 秒超时；ZIP 条目、解压大小、名称、链接和 XML 声明受限 |
| Excel 累计单元格工作量 | 创建/编辑统一累计工作量预算，多次合法范围操作不能绕过单次请求上限 |
| PDF vision 达到图片预算仍继续渲染 | 耗尽图片预算后停止调度后续页面 |
| 公式、DOCX 主动部件和嵌入包 | 拒绝主动外部公式、外部连接、危险字段/关系和不支持的主动内容；嵌入 XLSX 有共享解压预算；普通表格结构化引用保留 |
| Host 命令取消永久等待 | 有界进程树清理和关闭等待；失败保留 typed 清理记录、写入屏障及恢复确认；大输出仍保留有界头尾恢复 |
| 初始化失败仍占用进程与单实例锁 | 初始化失败执行有界清理并以失败状态退出 |
| ACP 失败/中断/取消失败不悬挂 | `run_failed`、`run_interrupted` 与提前到达的终态均结算；并发 prompt 不覆盖已有 waiter；abort HTTP 503 和永不响应均在短测试上限内以“远端停止未确认”结算并清理本地 waiter |
| BrowserDock 本地文件预览 | 只允许与会话、provider、guest 和工作区绑定的文件请求；顶层和子资源都必须受限 |
| 文档覆盖在哈希与替换间有竞态 | 固定父目录与旧目标句柄；旧 SHA、备份及提交后 identity/size/hash 复核，不一致时明确失败并保留外部编辑或恢复备份；Windows 两步 rename 仍有短暂 gap，不宣称无间隙原子替换 |
| MCP OAuth 重定向泄露、编辑密钥丢失 | Token POST 禁止重定向；留空保留已声明旧键，删除键名移除凭据，未声明秘密键拒绝 |
| Skills 市场异步覆盖 | 过期响应不覆盖新来源，安装使用结果本身的来源 |
| Headless 创建配置校验不足 | 与正常创建共用 SessionService 校验；不支持的父会话/分支创建参数明确拒绝 |
| Office 检查不完整仍返回成功 | 结构、渲染、重算分开记录；不可用/失败/抽样截断不报告完整 verified；导出 PDF 不等于视觉验收 |
| 附件类型与图片完整性 | 伪 PPTX、二进制文本、危险 ZIP 路径和损坏图片拒绝；格式不支持时明确失败 |
| 实验入口复用旧构建与旧沙箱 | 每次启动先验证固定沙箱哈希并重新构建，失败不启动旧产物 |
| 插件市场清单截断、并发丢失与 stale 锁误删 | 同目录临时文件替换，串行化更新；正常写入等待 15 秒，stale fixture 验证超过 60 秒只报锁路径、原锁和 catalog 均不变，不按 mtime 自动删除 |
| 回退历史遗留工具输出 | 随删除的 callId 清理有界输出及索引，事务失败一同回滚 |
| 粘贴内容后自动格式预览 | 移除粘贴触发的自动切换；Markdown、公式、键入、IME、图片附件及三模式/QuickChat 保持可编辑原文；预览由用户手动选择 |

### 打包与接口定向验证

- 10份打包、运行时、路径、图标、TencentDB和Work技能来源Node测试文件串行通过：**80/80，0失败、0跳过，97.16秒**。包含迁移后的hoisted/app-local解析、Windows复制和目录保护、真实ASAR依赖闭包及缺失拒绝、图标损坏恢复、124个物理技能来源逐项对账。
- 插件SDK本地smoke最终 **11/11**：进程内和跨进程并发更新保留全部条目，超过60秒的锁只报错，原锁及catalog字节不变。正常等锁最多15秒；人工恢复仅能在确认无writer后删除确切锁文件。
- ACP本地SSE/HTTP fixture最终 **7/7**：提前完成、失败、中断、并发prompt拒绝、abort HTTP 503、永不响应abort及取消失败后新prompt均可结算。abort默认10秒硬超时，测试注入短上限；失败明确报告“远端停止未确认”，不对普通prompt设置总运行时限。
- 文档旧稿入口最终定向 **5文件、153通过、3跳过**：`openEditableDocx`、`prepareDocxEdit`、模板与`authorOfficeDocument`均复用递归嵌入XLSX策略；缺失/重复包关系、内容类型不一致和危险工作簿被拒绝，应用自身生成的安全图表工作簿仍可编辑并保留。这些定向数字与后续完整套件有交集，不累加。

### 完整集成回归过程

首轮串行完整Vitest退出1，用时703.28秒：152文件通过、3失败、3跳过；2109项通过、6失败、14跳过。失败集中在`decision-memory-runtime.test.ts`的Office验证夹具及3个记忆异步等待断言、`token-saver.test.ts`的旧成功流夹具，以及`tool-cache-index.test.ts`的取消提示文案。Office夹具补齐结构化`officeVerification`，仅满足`render=verified`后读取页面；记忆测试等待明确的analysis/add入队信号并保留10秒硬超时、取消/禁用后的不备份和不落盘断言。Token Saver夹具补正式`finish_reason:stop`，保留首个截断请求失败、重试成功及两次用量完整统计的断言。Host恢复原有中文取消提示，进程停止确认、未确认屏障及完整输出恢复不变，没有放宽安全策略迁就测试。

修正后上述三个文件统一串行复测：**3文件、95项通过，退出0，31.33秒**；随后重新执行完整串行套件，结果见下方。本次定向结果与完整套件有交集，不累加。

### 最终源码门禁

- 完整串行Vitest：**155个文件通过、3个跳过；2115项通过、14项跳过，0失败**，退出0，用时**337.84秒**。命令为`node ../../node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism`，执行目录为`apps/desktop`。
- `pnpm typecheck`：Node与Web两套TypeScript检查通过。
- `pnpm lint`：Biome **398个文件**通过，无自动修改。首轮发现`composer-draft.ts`和`queued-prompt.ts`两处导入排序，按规则整理后重新通过；完整套件之后只有这两处导入顺序调整，没有运行行为变化。
- `pnpm build`：通过；TencentDB固定源**25个模块**一致，main **141**、preload **3**、renderer **2255**模块；产物为main **1,801.61 kB**、preload **31.64 kB**、renderer JS **2,581.32 kB**、CSS **365.20 kB**，renderer入口为`index-C1HWG2pE.js`及`index-9s72hnjt.css`。
- 构建后执行`.\package-win.cmd --check`：退出0，**13,865项资源、生产依赖及版本1.3.4**通过。这是源码资源预检，不是NSIS安装包验收。
- `git -c core.safecrlf=false diff --check`：通过；文档收尾后再次核对最终差异通过。

### 最终真实Electron与ASAR专项

生产构建后串行执行以下专项，没有并发启动测试桌面实例，也没有操作用户正在运行的实例：

```powershell
node scripts/composer-source-paste-smoke.mjs
node scripts/composer-rich-paste-smoke.mjs
node scripts/browser-file-boundary-smoke.mjs
node scripts/document-asar-smoke.cjs
```

- 原文粘贴专项：**9/9场景、23张截图、32组尺寸测量**通过；证据为`.impeccable/review/v134-composer-source-paste-1795151755281/result.json`。覆盖简约/光轨×Code/Work/Chat、QuickChat、原文/手动预览、键入与模拟IME、图片附件，以及文件选择/拖入/图片粘贴的数量和容量限制。真实运行中替换队列附件超限时，FileReader与queue-update IPC均为0，原队列正文保留。仅1次明确的本地挂起fixture请求，0异常、崩溃、服务错误及意外网络请求。
- 原文专项首跑`.impeccable/review/v134-composer-source-paste-1795151690824/result.json`因`Missing composer file input`失败：Code/Work的文件input需先打开“引用”面板才挂载，夹具过早查找。修正为先点击`capability-picker-trigger`并等待`capability-picker-panel`后定位input，随后完整重跑得到上述9/9；没有修改产品挂载时机。
- 格式预览专项：**11/11场景、8张截图、6组响应式测量**通过；证据为`.impeccable/review/composer-rich-paste/result.json`。覆盖手动预览、原生撤销/重做、选区与快捷键、HTML清理、公式、长文本降级、图片、设置即时生效与重载，以及1440/1040/800视口；仅1次本地fixture请求，0异常、崩溃、服务错误及意外网络请求。首跑在再次粘贴时仍按旧行为等待保留预览而失败，失败截图保留为同目录`failure.png`；夹具改为断言textarea可见且聚焦、preview=false及原文正确，保留发送和网络断言后完整重跑通过，未改运行时迁就旧等待。
- 两套输入区专项最终**31张截图均已逐张检查**，主流程另查看光轨Chat、QuickChat及800/1440代表图，未见控件重叠或容器溢出。剪贴板测试使用合成ClipboardEvent和Chromium原生编辑，不读取或写入系统剪贴板；模拟IME和Chromium视口不代表物理输入法、辅助技术及完整Windows DPI/GPU矩阵验收。
- 本地Browser边界：**6/6断言**通过；工作区内顶层HTML、CSS及脚本正常，工作区外脚本、图片、iframe内容和fetch不暴露内容，内部授权能力不出现在地址栏。使用独立临时profile及项目，测试后清理。
- 真实ASAR文档运行时：退出0，离线中英文OCR、PDF页渲染、旧DOC、原生OMML/Markdown/图表/内嵌工作簿、KaTeX MathML、DOCX/PPTX作者依赖及隔离包解析通过；所有作者依赖均从夹具ASAR或其unpacked路径解析。这是依赖闭包及文档fixture验收，未生成或运行正式安装包。
- 文档及进程收尾：**11份Markdown可解析、169个本地链接全部存在、无NUL**；根package、桌面package和`APP_VERSION`均为1.3.4。本轮Vitest、输入区、Browser及ASAR测试进程残留为0；临时profile按确切路径清理，未碰用户正常实例、历史临时目录或已有修改。先前临时Browser审计目录、probe及误生成的PowerShell路径均确认不存在，正式源码和专项脚本保留。

本轮测试使用临时工作区、临时 profile、本地 HTTP/SSE fixture 和确定性进程替身。真实供应商、真实 Office COM、MXC/Docker、正式安装/升级不在这些回归结果的证明范围内。

## 发布边界

- 本版本不新增数据库 schema，不修改政策修订号、原子图标或用户数据目录。
- 未获明确要求不生成正式 NSIS/ZIP、不执行云 SQL、不安装/升级、不访问正常用户数据库或 API Key、不提交或推送。
- 重新打包后必须重新计算 1.3.4 ZIP 的 SHA-256、字节数和内部安装器信息；不得复用 1.3.3 发布材料。

## ChatAgent 联网控制与 Crow5 调研（2026-11-20）

用户要求为 ChatAgent 增加会话级联网允许/禁止控制，并调研 Crow5 对比；Crow5 仅研究，不根据差异修改产品功能。应用版本保持1.3.4，不新增schema迁移。

联网状态保存在现有`app_settings`，旧会话默认允许。主 Chat 与快捷 Chat 提供“允许联网 / 禁止联网”按钮；运行、发送准备和审批期间锁定。开启时只允许`web_search`、`web_fetch`且不逐次审批，仍执行HTTP(S)、公网目的地及网页读取限制。关闭时不向模型请求暴露两项工具，主进程普通执行及受管执行路径均拒绝伪造或迟到调用。分支、同组新建和快捷 Chat 续期继承来源会话的禁网状态；自动队列按发送时会话状态执行，不沿用入队时授权。

最终安全复核额外发现并修正两点：成功更新联网设置后通过现有`session_updated`事件广播最终会话状态，确保主窗口与快捷 Chat 同时显示一条会话时按钮即时一致；SessionService创建会话时严格验证联网字段为布尔值且仅可用于ChatAgent，防止无效IPC数据回退为默认允许。两项均有代码回归；跨窗口行为另有真实Electron smoke。

### 最终验证

- 完整串行 Vitest：**155个文件通过、3个跳过；2121项通过、14项跳过，0失败**，退出码0，453.62秒。覆盖此次创建字段校验，以及既有联网工具过滤、工具执行拒绝、审批策略、状态持久化、忙碌锁定、分组/分支/快捷Chat继承。定向测试与完整套件有交集，不相加。
- `pnpm typecheck`：Node与Web TypeScript通过。
- `pnpm lint`：Biome **398个文件**通过，无自动修改。
- `pnpm build`：通过；TencentDB **25份固定源模块**校验一致，main **141**、preload **3**、renderer **2255**模块；产物main **1,804.18 kB**、preload **31.64 kB**、renderer JS **2,583.19 kB**、CSS **366.60 kB**。
- `node --check scripts/orbit-workbench-smoke.mjs`与`git -c core.safecrlf=false diff --check`通过。
- 构建后`.\package-win.cmd --check`退出0：**13,865项资源、生产依赖及版本1.3.4**通过；没有生成NSIS安装包。
- 联网UI专项：`$env:MSH_ORBIT_NETWORK_ONLY='1'; node scripts/orbit-workbench-smoke.mjs` **3/3场景通过、8张截图、0模型请求、0renderer异常、0fixture错误**；证据`.impeccable/review/v133-orbit-layout-1795158398376/result.json`。主 Chat 与快捷 Chat 同看该快捷会话时分别切换联网，另一窗口的按钮即时同步。另覆盖快捷窗口540×720、400×560以及Chat主界面1440/800、中英文、日夜；实际人工抽查了1440夜间主Chat、800日间Chat和400×560快捷Chat截图。

完整工作台`scripts/orbit-workbench-smoke.mjs`也尝试运行，但**没有通过**：前9个场景通过后，任务面板复载检查在`taskDockEvidence`等待重载后的600px面板/ARIA值超时，尚未查明是夹具时序还是实际尺寸恢复问题，失败记录`.impeccable/review/v133-orbit-layout-1795157777047/result.json`。该失败发生在脚本到达联网场景前；因此这次只将独立联网专项记为通过，不将完整工作台smoke报告为通过。专项入口早先误用Code/Work会话选择器、未进入同步断言，改为ChatAgent分组行后最终3/3通过。

### Crow5 对比研究

调研报告见[Crow5与Mingshen Harness功能对比](CROW5_COMPARISON_1.3.4.md)。按官方首页实时版本、官方手册数据、宣传自述及第三方内容区分证据。报告指出Crow5公开展示的差异包括统一创作工作站、可视化多Agent协同、文件/命令/历史统一命令面板、可交互多标签终端、官方策划Skill Hub与项目级MCP市场、代码时间线/单文件回退和图片无限画布；Mingshen在ChatAgent权限隔离、细粒度Office旧稿编辑及验证、本地插件SDK、后台SubAgent、自选模型及权限/恢复闭环有更明确的实现。Crow5官方“500+ Skills”“200+模型”等仅按宣传口径记录；手册v6.46.0为较早客户端阶段，不等同于v1.3.31实机验收。没有安装Crow5、未做同任务性能/质量基准、未提交或实施报告中的产品建议。

本轮联网开关只限制ChatAgent主动`web_search`/`web_fetch`，**不代表应用整体断网**；所选模型供应商连接、更新检查和主动上传附件发送不受此开关阻断。Crow5为公开资料调研，实时浏览官网不代表产品内ChatAgent联网开关的网络执行实测。用户正常profile和会话未访问；没有调用付费模型、执行云SQL、生成/安装正式包、提交或推送。桌面烟测使用隔离临时profile和本地fixture，测试Electron已退出；用户已有的`server.mjs`进程未触碰。

最终文档收尾：Marked解析10份Markdown，153个相对本地链接目标存在，无NUL；`git -c core.safecrlf=false diff --check`及smoke脚本语法检查通过。最终`pnpm typecheck`、Biome 398文件和`.\package-win.cmd --check`通过；预检13,865项资源、生产依赖及1.3.4版本。没有生成正式安装包。

## 创作工作面与项目协作扩展（2026-11-20）

本轮实装 Mingshen 工作站、生图工作台、AutoDrive、多角色总控、统一搜索、多标签交互 Shell、行评论审阅、分支/worktree 导航和草稿辅助。版本仍为1.3.4，schema9、政策修订号、图标与用户数据路径不变。下列新增证据与上方较早阶段结果分别记录，不累加通过数。

### 实现与核对合同

- 工作站实际目录为348个稳定ID、29类任务结构及每类12种针对性场景，按12个分类检索。模板包含受众、章节、流程和验收要求，属于可编辑工作流，不是348份Office二进制模板。草稿支持分节编辑、撤销重做、工作区保存和JSON导入导出。空章节标题可以保存恢复；损坏或不可读的存储原值不被覆盖。写入失败的草稿可在同一renderer内切页恢复并重试，成功持久化后才清理恢复副本。WorkAgent交接等待草稿持久化和目标复核，冲突或失败不假报成功；重试不重复追加，保留正文及附件。
- 生图工作台分离图片与文本/视觉模型，文本入口拒绝图片输出专用模型。当前图片请求使用用户配置的OpenAI Images兼容接口，只接受Base64图片，不追随结果中的远程图片URL。润色和反推结果需显式应用，过期建议不能覆盖更新的提示词。画布支持平移、缩放、图层编辑、本地素材及带素材工程；PNG/JPEG/WebP/GIF做有界完整像素解码，动画逐帧检查，APNG暂不支持。GIF由所选图片帧合成，不属于AI视频生成。
- AutoDrive没有工具，结合当前模型、历史、计划和有界仓库证据提出3至5个方向；遵循Profile读取策略并在读取后、请求前复核权限。worktree必须已存在，不创建或回退主目录；选方案只追加草稿。协调器拆解2至6个真实工作包，使用18个内置角色与既有并发、审批和写入租约；父任务可独立工作。实际验证、独立QA和质量状态分别保存，缺验证不会只凭QA文本显示通过。
- 文件搜索和本地审阅使用当前会话的实际根目录。分支归属来自会话记录，未记录的旧会话保持未知。Git/Branch/会话/上一轮审阅使用旧新行号、版本指纹及受保护文件读取；Git工作区diff固定HEAD对象后在内存计算，限制输入、时间、编辑量和输出。评论发送前再次核对，只有草稿持久化成功后才移除待交接意见。
- 交互Shell使用node-pty/ConPTY与xterm，仅主窗口可信Code/Work、完全访问、非patch-only和host/实际worktree允许主动创建。窗口/会话/应用关闭尝试有界进程树清理，未确认保留错误和重试记录。它以当前Windows用户身份执行，不构成文件系统或进程隔离；启动目录检查仍有check/spawn窗口，独立退出的Shell可能留下脱离管理的后代。
- 草稿润色只发送原文及语气指导、不开放工具，显式确认才替换。临时指令只属于一次已接受发送或队列项；项目语气按工作目录保存，不提高权限。Ctrl+Shift+P按当前模式过滤命令、会话和工作区文件，Chat不显示本地能力。

### 回归过程与失败保留

首轮新增功能完整串行Vitest退出1：**173文件通过、4文件失败、3文件跳过；2292项通过、8项失败、14项跳过，418.72秒**。4个测试文件的旧夹具没有同步新合同：local-plugin替身缺少`listAgentProfiles`，队列替身模型缺少text输入模态，SubagentStop精确返回断言缺少`childSessionId`，内置角色数量仍期望10。补齐替身和新增字段/数量的精确断言，保留原Hook、审批与生命周期断言，未放宽生产校验；四文件定向复测**74/74通过**。之后继续执行完整回归，最终结果在本节收尾记录。

第二轮完整回归退出1：**176文件通过、1文件失败、3文件跳过；2305项通过、1项失败、14项跳过，395.48秒**。真实LSP缺失程序测试收到`write EPIPE`，未保留启动原因。核对发现进程错误可能早于guarded读取或JSON-RPC请求，且stdin错误可能早于cross-spawn的实际ENOENT事件。修复持久化错误状态、取消/结算活动读取、保留可执行文件上下文与真实错误，后续实际ENOENT亦保留；不把单独EPIPE伪装为ENOENT。从创建进程即记住真实close，已有exitCode也不代替close；5秒内未确认关闭时返回清理未确认并保留原因。定向**13/13通过**，覆盖受控事件顺序、pending请求和关闭未确认。边界读取测试改用可正常启动的受控子进程，避免缺失程序先失败而掩盖所测试的路径/容量限制。

项目审阅专项首跑在成功完成前5个场景后超时，失败证据为`.impeccable/review/v134-project-review-1795180098603/failure.json`：测试点刷新后只等待已经成立的stale标记，尚未等到新diff，就给旧版本添加新评论；刷新完成后产品正确拒绝这些过期评论。夹具改为等待实际`newer value`及刷新完成，再移除旧意见、等待stale解除，未修改产品审阅规则。完整重跑先得到7/7，后续扩展滚动和真实指针场景后的最终结果见下方8/8。

项目专项第二次7/7功能通过，但逐图发现4张审阅图均仍在加载，不能作为加载后布局证据。补充等待真实文件、旧新行号和非loading状态，在最终构建下完整重跑，使用下方最终目录。

图片打包测试曾在Node **24.19.0**默认隔离运行中报`Unable to deserialize cloned data due to invalid or unsupported version`，未到达全部断言；同一文件非隔离运行9/9通过。调查显示builder缺失备用README路径时直接分段写stdout，与测试事件交错高度相关。仅调整测试日志捕获，通过`t.diagnostic`保留全部消息；生产检查器不变。默认隔离入口此后连续10次9/9通过，集成负责人再次运行9/9通过。不能将首次基础设施异常记成产品断言通过。

原先宽范围Orbit脚本的600px恢复失败仍保留为上节历史；本轮独立工作流专项验证连续重载600px及匹配ARIA值通过，不能据此将旧完整Orbit脚本改写为已通过。

创作与生图专项在最终成功前保留了夹具失败：下载截获在Blob URL释放后再fetch而失效，改为保留实际Blob再解码；页面断言错误地要求后台会话DOM卸载，改为核对该区域真实隐藏；会话选择与重载等待没有绑定实际标题/模式和新document，改为等待权威可见节点及明确异步结算。PNG/GIF检查改为直接传递实际字节，不通过CSP禁止的data-URL fetch。没有为迁就这些等待而改动生产行为。成功运行后，逐图检查仍发现800px共享顶栏按钮相互挤压、生图属性栏遮挡画布工具，以及Orbit 1440英文审阅的添加意见按钮进入执行区；这些属于真实布局问题，另行修复并以最终桌面重跑证据验收。

审阅布局改为整个面板可滚动，代码和待送入意见分别保留有界滚动，执行检查区不再被挤压。增加600字符选区、7条待送入评论及真实指针点击后，中间一次`.impeccable/review/v134-project-review-1795183983005/failure.json`严格断言发现`scrollIntoView({block:"nearest"})`仍有约0.67px目标边缘被裁切，虽然内部五点均命中，也没有放宽完整矩形可见要求。夹具改为居中滚动，最终8/8通过；不能据此声称nearest也满足完整可见。

生图面板增加可访问的素材库/设置开关：800px默认收起，展开时占据实际网格列；680px及以下的抽屉从画布工具栏下方开始，互斥并有关闭入口。开关不改图层几何或已有平移/缩放状态，适应画布由用户显式触发。共享顶栏按创作工作面收起仅用于对话的布局操作，并在窄屏压缩模式与更新控件。一次严格复跑`.impeccable/review/v134-creative-image-1795184913380/failure.json`在前12组功能通过后仍发现Orbit中文日间800px设置按钮与快捷键警告重叠约5.25px，不能只按中心可点击判为通过。进一步确认`studio-navigation.css`先于主题加载导致相同特异度规则被覆盖；将它移至`main.tsx`所有主题样式之后，并明确窄屏间距与更新按钮宽度。随后保留原严格矩形、命中与更新/警告同时显示的断言，完整重跑14/14通过。

### 完整源码回归

- 最后一次完整串行Vitest退出0：**177个文件通过、3个跳过；2312项通过、14项跳过，0失败，411.88秒**。执行目录`apps/desktop`，命令为`node ../../node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism`。包含LSP真实失败及受控事件顺序修复；定向测试与完整套件有交集，不累加。
- 完整套件之后的收尾修改限于审阅滚动、顶栏和生图工作面布局及桌面夹具；Node/Web类型、Biome、最终生产构建和相应真实Electron流程另行重新执行，不将此前构建自动当成最终UI证据。

### 真实桌面与依赖证据

- `node scripts/workflow-tools-smoke.mjs`：**12/12场景通过、5截图**，证据`.impeccable/review/v134-workflow-tools-1795179701190/result.json`。真实UI覆盖润色预览/确认/取消、单轮临时指令、四范围审阅IPC、原生Ctrl+Shift+P、AutoDrive三方案/选择/取消、两个真实worker重叠与父任务继续、普通审批下执行验证命令、独立QA，以及缺少验证时降级失败。另验证Orbit连续重载600px、实际xterm输入、两个PowerShell标签与关闭后PID消失。32次本地fixture请求、2次验证审批、最大同时worker数2，0renderer异常及0fixture服务错误；5张截图已逐张查看。
- `node scripts/project-review-smoke.mjs`：最终**8/8场景通过、10截图、41组测量**，证据`.impeccable/review/v134-project-review-1795184290417/result.json`。真实后台完成建立worktree与未读标记，工作树文件搜索不回退宿主，分支分组使用实际记录；统一搜索打开真实文件/历史/命令，Chat过滤本地能力，真实终端打开并停止。四范围可选择，过期评论保留且拒绝提交；旧新行评论追加到原有附件草稿且不发送消息。Orbit 1440英文审阅实际滚动至600字符选区、7条待送入意见、末条删除和提交按钮，以真实指针完成操作，最终6条意见进入既有附件草稿，已删除意见不再出现。严格核对裁切祖先、完整矩形及内部五点命中。只1次本地模型fixture请求，0renderer异常及0fixture服务错误；10张截图已逐张检查，覆盖简约/光轨、1440/800、中英文、日夜组合，审阅图等待真实diff加载后采集。之后仅补充英文行号前空格和单复数，已进入最终构建。
- `node scripts/creative-image-studio-smoke.mjs`：最终**14/14组通过、32截图、180组几何记录**，证据`.impeccable/review/v134-creative-image-1795185334127/result.json`。覆盖348目录与12个教案场景、即时切页/重载保存及工作区隔离、空章节、写入失败同renderer恢复和显式重试、损坏原值保护、替换/导入确认及撤销；真实WorkAgent交接冲突留在原页面，解决后重试只追加一次，保留附件且不发送。图片流程包含无工具的润色预览/丢弃/确认、过期与卸载结算、实际Base64生成及视觉反推、本地素材、真实画布平移/缩放/图层编辑、独立解码的非空PNG/多帧GIF和携素材工程导入。画布面板开关、适应画布、缩放、平移及PNG导出使用真实CDP指针，另测800px双面板与680px抽屉边界。32个顶栏测量均同时显示合成的更新提示与快捷键警告，检查完整边界、零重叠及实际命中；另外32个工作面头部、83组面板控件状态和33组画布适配记录通过。共6次本地合成模型请求、0renderer异常、0fixture服务错误；主流程已抽查4张最终代表图。
- `node scripts/feature-asar-smoke.cjs`：真实Electron **45.2.1**在自制隔离ASAR/unpacked内加载sharp **0.35.5**、Windows DLL、node-pty **1.1.0**、diff **9.0.0**和gifenc **1.0.3**。PNG 1×1 RGBA解码、GIF 2×2编码后解码、行diff、实际ConPTY PowerShell输入、100×30至120×40调整、exitCode0和PID消失均通过。所有非内置依赖解析限定夹具ASAR/unpacked；结果输出到控制台，临时夹具自清，没有持久artifact。异常清理有唯一标记和PID归属检查，未做故障注入；网络限制不是OS防火墙证明。这不是electron-builder完整成品或正式安装包验收。
- `node --test scripts/package-image-runtime.test.cjs`：**9/9通过**。确认electron-builder默认排除依赖README后，为两种pnpm布局显式复制原生组件许可表；测试实际调用安装的builder复制器，并检查源/afterPack的固定版本许可哈希及缺失/篡改拒绝。运行时依赖闭包与原生DLL另有源码/afterPack预检；该检查不构成所有发行许可义务已履行的法律结论。

### 最终构建与资源门禁

- `pnpm typecheck`：Node与Web两套TypeScript通过。`pnpm lint`：Biome **457个文件**通过，无自动修改。
- `pnpm build`：通过；TencentDB **25份固定源模块**校验一致，main **157**、preload **3**、renderer **2290**模块；main **1,997.89 kB**、preload **35.97 kB**、renderer JS **3,446.71 kB**、CSS **453.37 kB**。最终renderer入口为`index-D8KAw9p-.js`及`index-mD0ncncx.css`，上方创作/生图最终专项使用此构建。
- 最终构建与文档更新后再次执行`.\package-win.cmd --check`，退出0，**13,865项资源、生产依赖和版本1.3.4**通过；没有生成正式安装包。
- Marked解析**11份相关Markdown**，**171个本地链接目标**均存在、无NUL；根package、桌面package及`APP_VERSION`三处均为1.3.4，最终renderer入口文件存在。`git -c core.safecrlf=false diff --check`通过。
- 只读检查未发现本轮创作、生图、项目审阅、工作流及ASAR专项的测试Electron/node进程残留；最新创作专项临时profile已清理。正常用户实例、历史临时目录和既有工作区修改保留。
- 最终创作/生图**32张截图均已逐张复核**：16张ImageStudio、8张简约工作站和8张光轨工作站，未发现新的明显遮挡、越界或标题栏重叠，主流程另查看4张代表图。静态检查限于当前滚动位置与对应面板状态，展开几何和鼠标操作由上述专项另测，不代表完整键盘焦点、Windows DPI或辅助技术矩阵验收。

### 当前边界

所有桌面测试使用自有临时项目、临时profile及本地合成HTTP/SSE服务，不使用正常用户DB/Key或真实收费供应商。工作站保存持续失败时，内存恢复副本不能跨刷新、崩溃或退出；界面提示先重试或导出。初次即损坏/不可读且没有失败副本的存储暂停自动保存，编辑内容需离开前导出。图片网关协议差异、真实模型质量、Microsoft Office COM、MXC/Docker、完整Windows DPI/GPU/辅助技术和正式NSIS安装升级仍未验收。未生成正式NSIS/ZIP、执行云SQL、提交或推送。

## 运行中引导（2026-11-20）

用户要求在实际主模型任务运行中发送补充要求，当前模型请求和工具操作继续执行。版本保持1.3.4，schema9、政策修订号、原子图标、用户数据目录和已有未提交修改保留。此节是新增行为的独立验证记录，不复用或累加前阶段的2312项结果。

### 核对合同

主Code/Work/Chat及快捷Chat通过单独动作发送纯文字引导，按FIFO进入当前run的后续模型请求；下一轮队列仍在当前run正常完成及清理后派发独立任务。引导不改写已传输的请求、不撤销已开始的操作，也不取消工具或子任务。实际SubAgent、手动压缩和独立AutoDrive不开放入口。

提交绑定sessionId、runId和幂等requestId；草稿revision、正文及无附件状态一同验证。每条最多8,000字符，等待最多10条，同run总量最多32,000字符；附件和临时指令不得被静默丢弃。正文按普通用户文字处理，沿用原有权限、联网、审批、隔离、工具轮数和上下文预算。

只有本次后续请求实际包含的内容才显示已接入；该状态不是远程接收确认或任务完成证明。停止、失败和重启保留未应用内容且不自动重发，后续run也不能静默删除旧正文。删除会话清理相应持久记录，快捷窗口仅能访问自己的有效Chat会话。旧草稿回执或跨窗口事件不应清空新草稿，也不能重置其他run的流式内容。

### 定向与脚本检查

- `repository-composer-draft.test.ts`与`quick-chat-controller.test.ts`串行定向：**2文件45项通过，0失败，1.68秒**。包括删除会话只清理目标引导记录，及快捷窗口拒绝跨会话引导与额外参数。此定向结果与后续完整套件有交集，不累加。
- 根目录使用`node --test --test-concurrency=1`运行全部12份`scripts/*.test.cjs`/`*.test.mjs`：**98项通过、0失败、0跳过，67.84秒**。覆盖图标、迁移路径、受限复制、原生依赖和许可、文档ASAR闭包、TencentDB、全部124个Work物理技能来源和本地评估合同；未运行不属于测试套件的`native-sandbox-test.mjs`实时探测入口。

### 回归过程与失败保留

首轮完整串行Vitest退出1：**178文件通过、1失败、3跳过；2349项通过、1失败、14跳过，418.41秒**，另有1项未处理错误。失败是既有`decision-memory-runtime.test.ts:602`等待真实审批broker的默认1秒`vi.waitFor`超时，实际待审批列表仍为`[]`；测试随后提前清理临时项目和关闭数据库，造成`EBUSY`及仍在执行的run访问已关闭DB。该用例单独运行及重复运行均通过，不据此将首次全量记为通过。修复限于测试的有界等待和在断言失败时先停止、结算run再清理，不放宽权限、拒绝或工具不执行的断言。

修正后完整`decision-memory-runtime.test.ts` **37/37通过，21.25秒**；原审批用例使用10秒有界等待、20秒测试上限，finally停止运行和审批并等待原promise结算，之后才交由fixture关闭DB和清理。随后重新执行全部串行Vitest，最终结果另记，不将单文件通过替代整套检查。

第二次完整串行Vitest退出0：**179文件通过、3文件跳过；2350项通过、14项跳过，0失败，396.83秒**，没有未处理错误。执行目录`apps/desktop`，命令为`node ../../node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism`。包含新增引导状态/运行时及草稿回执覆盖，定向结果与完整套件有交集，不累加。随后Node/Web类型检查及Biome **463文件**再次通过，无自动修改。

首轮真实Electron引导专项在进入引导动作前被夹具误断言阻断：合成剪贴板图片经过既有命名流程生成`clipboard-UUID.png`，脚本仍要求原始文件名。失败记录为`.impeccable/review/v134-run-steering-1795189527658/failure.json`，0renderer/fixture异常；改为核对生成名称、MIME、数量和草稿保留，保留产品既有行为后重跑。

### 真实桌面引导专项

`node scripts/run-steering-smoke.mjs`首次功能复跑**12/12场景通过、7截图、7组布局记录**，证据`.impeccable/review/v134-run-steering-1795189794234/result.json`。包含简约/光轨、Code/Work/Chat会话、日夜/中英文、1440与800主窗口以及400×680快捷窗口；输入区、引导按钮和状态区均无横向溢出并可实际命中。工具等待使用真实`ask_user`，未回答前不提前继续；当前工具call/result完整后才在同一run下一请求出现引导。持续SSE不会被引导关闭，当前轮最终文字后仍有引导时继续原run，已有队列直到此run完成才以新run派发。

专项另覆盖过期run、拒绝提交、附件及临时指令阻断、Shift+Enter与模拟IME、普通Enter发送、停止后未应用保留和renderer重载，以及主窗口/小窗共享草稿和迟到回执保留新正文。共18次本地合成请求，只有显式停止场景的SSE提前关闭，其他17次都正常结算；0renderer异常、0崩溃、0fixture服务错误、0意外网络请求。引导协议与重启恢复另由源码测试覆盖，不将renderer重载当作完整应用重启。

此专项使用功能构建入口`index-BUZa0a33.js`/`index-BvW2yLct.css`；其后双语内嵌手册的按钮名称、Enter/Shift+Enter行为及英文状态名与实际界面统一，并再次执行最终生产构建，运行行为未变。真实收费供应商、原生Windows输入法及完整DPI/辅助技术矩阵不在这些合成服务和Chromium输入记录的证明范围内。

首次功能复跑的7张截图均已逐张复核。复核发现3处Code/Work场景名与顶栏当前模式不一致：`orbit_zh-CN_code_1440`顶栏为Work，`simple_zh-CN_work_1440`和`orbit_en_work_800`顶栏为Code。夹具在同工作区会话已选中时提前返回，没有断言顶栏模式已激活；因此该记录证明真实会话API和同run续接，但不能单凭场景名证明两种顶栏模式的完整覆盖。后续单独修正夹具、显式核对模式与会话后重跑，最终证据另记。

补齐夹具的真实会话选择及模式校验后，最终引导专项退出0：**12/12场景、7截图、7组布局记录及16次会话/模式一致性检查通过**，证据`.impeccable/review/v134-run-steering-1795190928889/result.json`。每次同时核对`getSession.agentMode`、选中会话、应用`data-agent-mode`和顶栏`aria-pressed`，矩阵实际为简约中文1440 Code、简约英文800 Chat、光轨英文800 Work、光轨中文1440 Code、光轨英文1440 Chat、简约中文1440 Work，以及光轨英文400×680快捷Chat。快捷窗口没有独立模式顶栏，其会话模式及对应主窗口状态同时核对。

最终7图已逐张复核，主任务另查看Code宽屏、Work800和快捷窗口三图；未见引导区、输入框或发送按钮明显遮挡，7组测量均无横向溢出且控件命中通过。18次业务fixture请求中，仅显式停止的`STOP_PENDING`提前关闭，其他17次正常结算；0renderer/fixture异常、0崩溃、0意外网络请求。英文Chat侧栏仍可见少量既有中文文案，已记录为本轮引导功能之外的本地化边界，不能据此宣称全页面完全本地化。脚本语法检查通过，自有进程退出、临时profile删除，用户原有实例保留。

### 原有自动队列回归

`node scripts/queued-prompt-smoke.mjs` **16/16场景通过、9截图**，证据`.impeccable/review/v133-queued-prompts-1795190211064/result.json`。证据目录沿用历史脚本前缀，实际运行的是当前1.3.4源码构建。覆盖Code/Work/Chat真实会话、10条FIFO实际逐条派发及第11条拒绝、后台会话、编辑暂停、附件替换失败保护、配置变化、供应商500后暂停与显式恢复、手动停止、真实Electron重启、直接`@`子任务及实际SubAgent拒绝入队。QuickChat全部队列IPC继续拒绝；Chat队列接续时本地文件工具仍被模式权限拒绝。共38次本地合成模型请求；没有用引导功能替换或绕过队列派发条件。

队列9张截图已逐张复核，未见输入区、队列或按钮明显重叠、越界。Orbit英文夜间800px的暂停说明使用省略号，截图未显示完整文案，但恢复按钮完整可见；长会话名和模型名也有常规省略。静态复核不外推全部键盘、动态滚动及分辨率矩阵。

### 最终构建与资源核对（2026-11-21）

- 最终`pnpm typecheck`通过Node/Web两套TypeScript；`pnpm lint`通过Biome **463文件**，无自动修改。完整Vitest和脚本套件结果分别为上文2350项及98项，不累加定向结果。
- `pnpm build`退出0，TencentDB **25份固定源模块**校验一致，main **159**、preload **3**、renderer **2293**模块。main **2,015.02 kB**、preload **36.24 kB**、renderer JS **3,466.41 kB**及CSS **455.14 kB**；renderer入口仍为`index-BUZa0a33.js`和`index-BvW2yLct.css`。本次构建发生在最新桌面专项之后，最终变更仅为内嵌文档表述，未改变已验证的运行或布局源码。
- 构建后用户入口`.\package-win.cmd --check`退出0，**13,865项资源、生产依赖及版本1.3.4**通过；这里只运行资源预检，没有生成正式NSIS/ZIP。
- 最终核对11份相关Markdown可解析、174个本地链接目标存在且无NUL；根package、桌面package及`APP_VERSION`均为1.3.4，最终renderer入口文件存在。`git -c core.safecrlf=false diff --check`通过。
- 只读进程检查未发现本轮引导和队列专项的Electron/node残留，自有临时profile已清理；用户已有实验实例、正常数据和其他未提交修改保留。

本轮未使用真实付费供应商、正常用户profile/数据库/Key，也未执行正式安装升级、云SQL、Git提交或推送。合成SSE验证了接续时序与协议边界，不代表供应商必定采纳引导或完成要求；已接入仅表示进入后续请求。投影与最终持久消息的ID不同，可能减少后续压缩缓存命中；缓存源ID/哈希不匹配时拒绝复用，尚未做长会话缓存性能基准。

## 工作站模板、Skill 版本和侧栏（2026-11-21）

本轮版本保持1.3.4；保留schema9、政策修订、图标及用户数据路径。目录已扩至780个独立办公场景，每项有简略与详细版；详细版含场景专属资料、方法、产物、风险、业务流程及真实技能建议。原348个ID保留；旧草稿缺少版本字段时按简略版读取，切换版本保留编辑，预览、复制和追加WorkAgent草稿使用同一提示词。模板覆盖面及格式边界见[模板指南](WORKSTATION_TEMPLATES.md)，公开研究来源见[研究记录](WORKSTATION_TEMPLATE_RESEARCH_1.3.4.md)。

### 检查过程

- 早期内容复核发现同族正文仍有较高重复，且一批场景的字数来自字段相互复述。已作废该批早期统计，改为独立业务字段与族级专业流程，并检查简略和详细的分离。中间并行写入曾导致`legacy-details-a`重复结束符、缺少尚未完成的场景、C族详情字典暂时不完整；这些失败不算测试通过。
- 根脚本完整套件使用`node --test --test-concurrency=1`执行全部`scripts/**/*.test.cjs/mjs`，退出0：**98项通过，0失败、0跳过，62.22秒**。覆盖Windows复制及图标恢复、原生运行时、Office与图片依赖闭包、来源完整性和WorkAgent物理Skill目录。该结果验证文件与脚本合同，不等同于真实Office重算、安装升级或模板输出质量评测。

### 模板与技能核对

- 最终目录为 **780个独立场景、65个任务族、12类**，原348个ID保留，新增432个场景；简略与详细为同一场景的两个版本，共1,560个组合，不重复计算场景数。全部默认中文详细提示词实测 **1,128–1,454个Unicode Han字符，平均1,246.67**；简略版为 **667–929，平均768.82**。不以英文型号、数字或标点凑足800汉字。
- 详细版由场景专属资料、处理方法、产物和风险，以及同类共享的专业流程、格式和执行规则组成。扣除同族共同首尾后，四个场景字段为100–252汉字、平均150；同族中文三字片段Jaccard最大值的中位数为0.780，最高0.832，25/65族至少一对达到0.80。此数字记录共享规则的实际重合，不声称每项均独立撰写800字或已彻底消除相似。用户编辑后字数可变化，字数不能替代成品质量验收。
- 内容复核校正了海报工具的A4/Letter限制、库存周转零分子与零分母、培训人身安全优先、问卷授权和留存右删失等表述。收尾另修正兼职工时预算：预算和实际FTE分别为对应期间工时除以同期间全职工时基准，时薪只用于工资费用；零或缺失基准不可计算，不将合法排班或个体差异直接视为违规。纯空白交付格式统一回退模板格式，技能推荐、格式适配与提示词一致；其他空白字段使用既有默认，非空用户原文和备注保留空格。
- Work来源仍保留 **124份物理来源、104个正文SHA、93个名称**；同源同路径的9个版本组合并26个历史项，自动发现与手动列表提供 **98个活动来源**。PDF的production、viewer、reading、loose独立来源保留；Code9项、Work16项基础入口不变。旧选择规范化不绕过有效的旧版专属deny/ask，取消或重选也不解除限制；实际调用、预载及Headless/SDK统一检查，不继承旧allow或跨变体权限。
- 模板、技能绑定、索引和草稿持久化最终定向为 **4文件48项通过**；技能版本及权限定向为 **3文件81项通过、1项环境跳过**。定向结果与完整套件有交集，不累加。

### 桌面复核过程

项目侧栏专项的前两次失败分别保留于`.impeccable/review/v134-project-review-1795197224322/failure.json`和`.impeccable/review/v134-project-review-1795197746816/failure.json`。第一次没有为新profile配置模型，实际仍在设置页；第二次在前三组通过后发现800px光轨左栏被尚未关闭的右侧抽屉遮罩覆盖。夹具先配置本地合成供应商，再通过真实指针关闭确实遮挡的抽屉，保留原侧栏几何与命中要求，没有模拟产品状态或删除遮罩。

`node scripts/project-review-smoke.mjs`最终 **10/10场景、20截图、60组测量通过**，证据`.impeccable/review/v134-project-review-1795198614109/result.json`。其中18组为侧栏空态、项目/分支、折叠、长列表及有界错误的几何测量，另有真实抽屉关闭命中；覆盖简约/光轨、1440×900和800×600、中英文与日夜组合。并回归统一搜索、真实worktree与未读、终端停止及四范围审阅、过期评论拒绝和保留附件的草稿交接。只有1次本地fixture请求，0页面异常、0服务错误；20图已逐张查看，主任务另抽查3张侧栏代表图。未见原反馈中的顶部大块空隙或控件/列表重叠。窄侧栏的worktree分支名会常规省略；英文截图中的中文是先前保留的用户草稿，不能单凭截图推断英文生成文案。

AGENT第70节和上文旧阶段的2350项结果不作为本次代码门禁。完整源码、工作站桌面专项及最终构建资源检查在本节单独记录。

### 完整源码与最终构建

- 完整串行Vitest先在模板收尾前通过181文件、2376项；随后FTE文案回归和空白字段修复进入源码，再次执行`node ../../node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism`。最终退出0：**181文件通过、3文件跳过；2379项通过、14项跳过、0失败，391.58秒**。定向结果不与之相加。
- 最终`pnpm typecheck`通过Node与Web两套TypeScript；`pnpm lint`通过Biome **479文件**，无自动修改。根脚本完整套件98项通过，见本节开头；后来仅增加桌面夹具的捕获和截图，不改变根脚本套件覆盖的生产合同。
- `pnpm build`退出0，TencentDB **25份固定源模块**一致；main **159**、preload **3**、renderer **2306**模块。产物main **2,021.39 kB**、preload **36.24 kB**、renderer JS **4,672.06 kB**及CSS **458.94 kB**；最终入口`index-28RWupbL.js`和`index-CsLwKf3k.css`。此前project专项使用同一侧栏/项目代码构建`index-BhGmkNoi.js`，此后的差异仅为模板FTE、空白字段及内嵌文档，未改侧栏或项目行为。最终工作站专项使用本条最后构建。
- `package-win.cmd --check`退出0，**13,865项资源、生产依赖与1.3.4版本**通过。这是资源预检，没有生成正式NSIS/ZIP。

### 工作站桌面复核过程

首次最终构建专项在15组通过后，于PNG下载等待超时：`.impeccable/review/v134-creative-image-1795199305657/failure.json`。新加的Profile交接场景重载了renderer，清除了之前安装的下载捕获，后续仍等待旧数组索引。夹具在重载后重新捕获实际Blob，按当前索引收取PNG/GIF/JSON；另拦截并统计意外的原生下载，防止捕获遗漏写入测试profile外。不扩大超时，不修改产品导出代码。

修正后`node scripts/creative-image-studio-smoke.mjs`先完整通过 **19/19、40截图、460组几何记录**，证据`.impeccable/review/v134-creative-image-1795199616008/result.json`。覆盖780目录、分类/格式/多关键词交集、空结果及后页模板；简略/详细切换、撤销重做、旧草稿、即时离页/重载、失败保存恢复和损坏存储保护；同源PDF最新版和独立变体的手动选取；完整提示词预览/复制/追加的逐字一致、原附件与历史保留、冲突后幂等重试；兼容自定义Agent配置保留和仅Code配置拒绝。图片流程继续验证实际Base64生成、视觉反推、画布操作以及独立解码的非空PNG/多帧GIF及携素材工程。

40张截图均逐张复核，主任务另抽查4张代表图。静态图未见明显遮挡，但均为折叠完整提示词、窄屏面板收起，不能单凭这些图声称展开内容已完成视觉验收。因此补充三种代表布局的简略态、完整提示词展开/原生滚轮到底及打开面板截图，最终证据在下方收尾记录。原19/19同时已有真实指针和完整矩形/命中记录，覆盖两主题、双语、1440/800及680边界；图片800px双面板和680px互斥抽屉通过。

### 最终桌面证据与视觉复核

最终`node scripts/creative-image-studio-smoke.mjs`退出0：**19/19场景、55张截图、466组几何记录通过**，证据`.impeccable/review/v134-creative-image-1795200332748/result.json`。使用最终构建`index-28RWupbL.js`，保留此前全部行为与严格边界断言；共6次本地合成请求，0页面异常、0服务错误、0逃逸捕获的原生下载。PNG、GIF和工程JSON均核对本次实际Blob字节，导出并非仅检查按钮可点击。

55张图均已逐张复核：24张工作站矩阵图、16张生图图，加15张代表布局的简略态、完整提示词顶部/底部、目录及预览展开图。代表布局为光轨中文日间1440、光轨中文夜间680和简约英文夜间800；通过真实CDP滚轮读到完整提示词底部再回顶，底部可见真实技能ID、用途及执行规则。未发现截图所示状态下明确的文字越界、控件遮挡或新增顶栏重叠；窄屏目录/预览打开后的遮罩为正常抽屉状态。静态截图仅证明对应滚动位置与面板状态，交互和可达性另由专项断言覆盖，不外推完整Windows DPI、键盘焦点或辅助技术矩阵。

最终12份相关Markdown经Marked解析，177个本地路径链接及28个标题锚点通过，无NUL；三处版本均为1.3.4，最终renderer的JS/CSS入口存在，`git -c core.safecrlf=false diff --check`通过。只读按两份桌面脚本及其唯一临时目录前缀查询node/Electron/实验EXE命令行，匹配进程为0；系统Temp下这两个测试目录前缀的目录为0。脚本也要求自有Electron退出再清理，不以creative的成功报告单独证明finally已执行；该查询不能绝对排除失去命令行关联的孤立进程。未读取正常profile、数据库或密钥，未停止正常实例或删除历史目录。

### 交付边界

本轮已完成模板字数、目录/技能绑定、版本兼容、权限、全量源码、构建和桌面流程检查；这些证据不代表780种模板已经逐一交付并评审真实Office成品。默认详细提示词长度与场景差异的实际边界见上文，不以字数替代专业质量。未调用真实收费模型、读取正常用户profile/数据库/Key，未实测Microsoft Office COM、MXC/Docker、完整Windows DPI/GPU/辅助技术或正式NSIS安装升级。没有生成正式安装包、执行云SQL、提交或推送。

## node-pty 原生依赖打包修复（2026-11-21）

用户执行正式入口时，源码构建及13,865项资源预检通过，但electron-builder26.18.0内置`@electron/rebuild`对node-pty1.1.0执行源码重编，Visual Studio2022缺少Spectre缓解库导致`MSB8040`。失败缓存为`windows-1.3.4-S66DIw`。该报错属于预检之后的真实构建阶段，不能用此前资源预检或自制ASAR夹具成功否认它。

### 修复与校验

- node-pty1.1.0已自带Windows x64 Node-API预编译，官方install优先使用该目录。对[官方npm归档](https://registry.npmjs.org/node-pty/-/node-pty-1.1.0.tgz)核对锁文件SHA-512，7份必要二进制逐项SHA-256与本地原包一致；固定值位于`scripts/package-native-dependencies.cjs`。不修改上游Spectre配置、系统组件、ACL或DLL。
- 打包包装器先校验预编译和加载优先级，再调用与builder同依赖解析路径的官方rebuild4.2.1；Electron45.2.1、win32/x64、prod/optional、sequential和disablePreGypCopy保持与原流程一致，仅忽略已验证node-pty。所有会按名称被忽略的实际目录均校验；目录/清单名错配、不支持布局、未知版本、丢失或篡改文件均拒绝。重编后复扫全部实例并比较目录集合，避免并发安装悄悄新增例外。
- 两套`build/Release`、`build/Debug`路径中共12种旧绑定会先于prebuild加载，发现即失败，不删除原文件。源预检与afterPack共用7份哈希校验，另检查console-list JS入口、绑定和相关DLL/EXE；原生模块仍须在ASAR unpacked中。
- 只有前述步骤全部成功，builder才收到`npmRebuild=false`以免重复重编；其他原生依赖已通过官方API处理。未使用`beforeBuild`返回false，因为当前builder会据此跳过生产依赖收集。真实构建日志确认仍执行pnpm生产依赖收集，afterPack继续核对依赖闭包。

### 本轮实际结果

- `package-win.cmd --check`退出0：**13,865项资源、生产依赖和1.3.4通过**。
- `package-win.cmd --dir`退出0，完成生产构建、原生依赖准备、实际electron-builder打包、依赖收集、品牌资源写入及afterPack。解包EXE为`%LOCALAPPDATA%\MingshenHarness\BuildCache\windows-1.3.4-QbDHsf\output\win-unpacked\MingshenHarness.exe`；FileVersion为1.3.4、ProductVersion为1.3.4.0。最终renderer仍为`index-28RWupbL.js`/`index-CsLwKf3k.css`。
- 全部13份根`scripts/*.test.cjs/mjs`串行运行：**108项通过、0失败、0跳过，48.04秒**。含新增10项官方payload、逐文件缺失/篡改、版本平台、旧绑定、重编范围、多实例/别名及重编后依赖变化回归。定向10项与108项有交集，不累加。
- 新增实际包模式`node scripts/feature-asar-smoke.cjs --archive <上述输出的resources/app.asar>`退出0。隔离Electron45.2.1中，依赖必须来自真实app.asar/unpacked，不能从宿主node_modules补齐；sharp0.35.5完成PNG1×1/GIF2×2解码、gifenc完成编码、diff正常，ConPTY完成真实PowerShell输入、100×30至120×40调整、exitCode0及PID消失。此模式只读取指定包，所有profile及探测文件位于自有临时目录。
- 首次实际包探测在启动Electron前失败，原因是旧夹具要求sharp README位于node_modules，而真实builder按既有许可配置将其存入`third-party-notices/sharp-win32-x64/`。分别检查自制夹具和真实包的正确布局后通过；afterPack的固定许可哈希校验未修改或放宽。

本轮没有修改应用业务代码、版本、数据库schema或用户数据，未再次运行完整Vitest；上节2379项是前阶段证据。正式NSIS/ZIP、安装升级、真实供应商、Office COM和完整Windows终端兼容矩阵仍未验收。测试不使用正常用户profile/数据库/密钥，未提交或推送。

收尾再次执行`package-win.cmd --check`退出0，**13,865项资源、生产依赖及1.3.4版本**通过；`feature-asar-smoke.cjs`默认自制ASAR模式亦再次退出0，ConPTY输入、尺寸调整、正常退出与PID消失，以及图片解码、GIF编码和diff检查均通过。4份本轮相关Markdown解析、158个本地链接、三处版本及diff空白检查通过。按ASAR探测脚本名和其唯一临时目录前缀只读查询，匹配的node/Electron/实验EXE进程与系统Temp目录均为0；该查询不能排除失去命令行关联的孤立进程。成功的`windows-1.3.4-QbDHsf`解包产物和原失败缓存均保留，未清理正常实例、用户数据或其他历史目录。
