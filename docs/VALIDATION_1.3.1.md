# Mingshen Harness 1.3.1 验证记录

首轮日期：2026-11-10（Asia/Shanghai）；最后补记核对：2026-11-11。首轮升级为1.3.1，修复工作区文件栏无法滚动、光轨会话标题与按钮重叠，以及无适用诊断器时显示虚假成功记录；下方保留该轮证据。随后补充光轨对话横向偏移、详情开合、长工具历史性能修复、输入框Markdown/LaTeX粘贴显示、持久草稿、扩展文档工具及按文件夹批量管理会话，分别见对应补充节。各表仅代表所在轮次，不能把历史构建或测试数字当作本次重跑。没有生成1.3.1安装包。

## 实际修改

- `styles.css`让文件浏览器在未打开编辑器时也使用受限的grid行；文件树可以缩小并独立滚动，滚轮不再传播至外层。编辑器打开时文件树最小42px，保留至少一行完整文件及编辑器正文。`WorkspacePanel`提供有名称、可聚焦的滚动区域，支持真实Home/End键盘操作。
- `workbench.css`由现有inspector容器负责面板定位，清除旧窄窗fixed/top规则，修复680px高窗口中面板底部落到738px的问题。文件页停靠命令时使用30%空间，打开编辑器后使用20%，允许命令区收缩。光轨在高度不超过760px且编辑器已打开时，将任务区收至已有紧凑规格160px，修复1040×680时编辑器正文被挤没的问题。
- 光轨会话行只覆盖左侧及纵向padding，保留共享普通会话36px、父会话65px的按钮留白。菜单按钮使用更准确的选择器保持28×28，避免全局图标按钮规则扩大尺寸；完整标题保存在悬停提示中。展开按钮、普通/父会话菜单和标题分别验证。
- `ProjectToolingService`及`LspDiagnosticsService`在实际选择并即将启动引擎时回调`onStart`。`ChatService`此时才发出检查进度；发现诊断器期间取消会在启动前抛出，不制造运行或失败活动。
- 自动跳过须同时满足内部`not-configured`或`not-applicable`标记、未启动引擎、服务器为空、报告成功且无诊断或错误。显式LSP即使使用相同名称，也继续显示真实状态。启动错误、检查失败及无输出失败保留；后者明确提示缺少错误详情。手动诊断返回契约、审批、隔离与写入锁未改变。

应用package、release、SDK/ACP、启动及打包入口和双语文档同步1.3.1。数据库schema7、永久迁移源文件、政策修订号`2026-11-04.3`、两枚既定原子PNG和25个TencentDB上游源码/源清单保持完整。`DESIGN.md`记录本轮局部布局约束，没有重做既定风格、配色或图标。

## 源码、构建及资源

| 检查 | 本轮实际结果 |
| --- | --- |
| 诊断定向Vitest | 3文件、34项通过，14.24秒，退出0；最终取消及同名引擎保护补丁之后执行 |
| 相邻聊天回归 | `context-compaction-service.test.ts`及`workbench-runtime.test.ts`，2文件、86项通过，6.50秒 |
| 打包/资源/图标Node测试 | 8文件、55项通过、0跳过，25.12秒，使用本机`D:\NodeJs\node.exe` v24.19.0 |
| Node/Web TypeScript | 通过 |
| Biome | 最终292文件通过，无自动改写；最后生产CSS修改后再次执行 |
| 生产构建 | main102/preload3/renderer2225模块通过；25个固定TencentDB上游源模块哈希通过，最终out包含本轮全部修复和内嵌文档 |
| 用户入口预检 | `package-win.cmd --check`通过33项资源、生产依赖及1.3.1版本核对 |
| 静态检查 | 新smoke脚本语法、diff空白、当前版本与受保护资源核对通过 |

定向Vitest在`apps/desktop`执行，使用Codex bundled Node24.22.1：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run src/main/agents/project-tooling-service.test.ts src/main/agents/lsp-diagnostics-service.test.ts src/main/chat/chat-service.test.ts --maxWorkers=1 --fileParallelism=false
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run src/main/chat/context-compaction-service.test.ts src/main/chat/workbench-runtime.test.ts --maxWorkers=1 --fileParallelism=false
```

其余命令在仓库根目录：

```powershell
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
.\package-win.cmd --check
& 'D:\NodeJs\node.exe' --test scripts/package-paths.test.cjs scripts/package-runtime-copy.test.cjs scripts/package-native-copy.test.cjs scripts/package-document-runtime.test.cjs scripts/tencent-memory-package.test.cjs scripts/prepare-experimental-runtime.test.cjs scripts/generate-icon.test.cjs scripts/windows-icon.test.cjs
node --check scripts/v131-pane-regression-smoke.mjs
git diff --check
```

没有重跑完整Vitest或全部历史桌面专项；不把1.3.0的全量数字计入本轮，不重复相加相邻与既有测试结果。

## 真实 Electron 回归

命令：

```powershell
node scripts/v131-pane-regression-smoke.mjs
```

最终完整运行退出0：8组通过、7次本地模型请求（含1次实际worker请求）、25张截图、36条几何测量、renderer异常0。结果在`.impeccable/review/v131-pane-regression/result.json`；截图只含独立临时profile、测试项目与合成内容，不随应用分发。

| 范围 | 实际覆盖 |
| --- | --- |
| 无诊断器写入 | 真实工具写入`.ps1`，检查持久轨迹不含`not-configured`虚假成功活动 |
| 六种界面组合 | 简约/光轨，各覆盖中文夜间1440×900、英文日间1040×680、中文日间800×680 |
| 文件列表 | 110个文本文件、嵌套目录及真实写入文件；滚轮到最后一行，聚焦后真实Home/End，首末行完整可见、末项可点击；固定标题未随文件滚动 |
| 编辑器及停靠 | 打开末尾文件，完整内容保留；命令停靠前后分别重复文件滚动，编辑器扣除padding后至少容纳一行正文，工作区底部不越过视口 |
| 会话按钮 | 真实spawn出的只读子任务、置顶父会话及普通长标题；鼠标展开、Enter收起、两个菜单打开/Esc关闭、当前选择不变、完整title及按钮几何不相交 |
| 已配置真实失败 | 临时工作区配置自定义stdio LSP，由`didOpen`实际发布severity1错误；持久轨迹保留固定错误标记及failed活动，审查区可见失败状态并能展开 |

旧生产输出的独立基线已复现原始问题：文件树按约2927px内容高度展开后被父区域裁剪，父会话标题侵入按钮区域。基线与最终结果分开保存，不能把旧截图作为修复后的证据。

代表截图：

- `orbit-zh-CN-night-1440-parent-menu.png`：光轨父会话标题、展开按钮和已打开的菜单。
- `orbit-en-day-1040-commands-docked.png`及`orbit-zh-CN-day-800-commands-docked.png`：窄窗文件末尾、编辑器和命令区。
- `simple-en-day-1040-commands-docked.png`及`simple-zh-CN-day-800-commands-docked.png`：简约面板底部与编辑器。
- `configured-diagnostic-failure.png`：实际LSP错误保持失败，未被无引擎跳过逻辑隐藏。

主流程已打开最终代表截图查看像素。独立审查者完成源码终审并逐张打开7张指定最终截图，未发现本轮修复的阻断问题；确认光轨标题与按钮分离、末文件完整可见、编辑正文与命令区未被挤出视口，以及真实诊断失败继续可见。该审查没有另行复跑测试。Impeccable context和detector本轮各执行一次，没有主要发现；28条旧样式建议未被当作本轮新增缺陷，也没有为收尾重复运行或修复无关样式。

## 失败尝试与边界

- 原始回归发现了真实的窄窗面板越界和编辑器正文高度塌缩，已修改产品布局并保留底部边界、完整首末行和正文高度断言后完整重跑。
- 自动化键盘测试偶发受页面激活时序影响，改为连接后设置CDP焦点模拟，移除每次按键前的重复激活；保留真实键盘派发和可见性断言，没有通过直接设置滚动位置代替Home/End验证。
- 最后的失败截图等待曾错误依赖固定“项目诊断”标题，实际有效标题为“诊断发现1个错误”；改为等待真实失败活动节点并展开。轨迹错误标记及failed状态断言继续保留，最终8组完整通过。
- 最初使用`package.json`的typecheck作为GUI失败夹具，本机Windows实际返回`spawn EINVAL`并正确显示失败。现有`ProjectToolingService`直接spawn `npm.cmd`的兼容问题本轮未修复；最终用真实自定义LSP覆盖已配置引擎的错误保留，不将npm.cmd执行记为通过。源码测试的模拟命令不能代替此Windows真实链路。
- 测试使用独立临时profile、项目、本地SSE与LSP，不读取或修改正常用户DB、Key、记忆或剪贴板，不调用付费模型。测试结束仅清理自身进程与受限临时目录。
- 本轮没有生成解包应用、NSIS或ZIP，没有安装、升级、卸载、上传、执行云SQL或Git提交/推送。真实付费网关、完整Windows/DPI及屏幕阅读器矩阵未验收。

## 实验版与后续打包

源码及内嵌文档已构建，正常退出托盘中的旧实例后运行：

```powershell
.\run-experimental.cmd
```

已有out时启动入口不会自动重建；以后修改源码仍须先执行`pnpm build`。

实际已有的1.3.0 ZIP仍为293630075字节、SHA-256为`551d665b93f174bf8f6ea8faa13647838ea22840ee83f66759d23afc98a35d17`。旧JSON、SHA256旁文件及`supabase/publish-release.sql`继续对应此真实旧包，不能换标签作为1.3.1。用户以后生成1.3.1正式包仍用`.\package-win.cmd`，完成后必须按新`.zip.json`重新生成发布材料。

## 2026-11-10 补充：光轨对话偏移与长历史性能

用户继续报告光轨对话概率偏移、展开再收起详情后聊天移出窗口，以及1.3.0下偶发无响应或崩溃。本轮修复实际复现的布局和重复渲染问题；没有复现renderer崩溃，不能据此确认全部崩溃原因已经消除。

### 原因与修复

- 真实Electron基线中，聊天外框约1096px，未声明列宽的内部grid却被折叠状态的长诊断撑到约94723px。历史与输入框按错误列宽居中，因而移出窗口；展开详情时滚动容器的自动最小尺寸改变，收起又恢复错误宽度。document宽度仍为1440px，单独检查页面横向溢出无法发现此问题。
- `workbench.css`为聊天及任务聊天视口明确声明`minmax(0, 1fr)`单列，聊天和输入区允许缩小，输入区限制最大宽度。保留原有纵向布局、详情内部滚动及代码块局部横向滚动，没有通过全局隐藏内容或每次重置`scrollLeft`规避问题。
- `MessageRow`及`ActivityTrail`使用React默认浅比较的memo，稳定空活动集合和文件/工作区/改写回调；即时语言切换仍由`useLocale`更新。新工具结果变化会正常刷新对应记录，没有自定义比较器忽略状态变化。
- 新增`ToolCallDetails`，折叠时只生成摘要，展开后才挂载命令、参数、输出及复制控件；格式化参数只计算一次。`ExpandableText`支持按需生成活动正文。完整来源与工具调用关联不变，未截短或删除历史。

### 最终检查

| 检查 | 此次补充实际结果 |
| --- | --- |
| 定向Vitest | `activity-details`、`orbit-transcript`、`ui-preferences`共3文件31项通过，1.55秒；未重跑完整Vitest |
| TypeScript及Biome | 最终Node/Web两套通过，293文件检查通过，无自动改写 |
| 生产构建 | main102/preload3/renderer2226模块，25个TencentDB上游模块源哈希通过；实验out及已有双语内嵌文档已更新 |
| 用户打包入口预检 | `package-win.cmd --check`，33项资源、生产依赖及1.3.1通过；未生成安装包 |
| 新稳定性专项 | 最终11组通过，1次本地模型请求、80段真实SSE；48条测量记录、13张截图，越界记录0，renderer异常及崩溃事件0 |
| 完整信息回归 | 11组、6次本地请求、35张截图，完整参数/输出/复制、真实命令失败、重连与历史阅读通过，renderer异常0 |
| 聊天滚动回归 | 19项、160段输出通过；上滑暂停、单按钮恢复、完成及思考开合保持原行为 |
| 文件栏及诊断回归 | 重新完整运行8组、7次本地请求（含1worker）、25张截图、36条测量，renderer异常0；不与上方首轮数字重复相加 |

定向测试在`apps/desktop`执行：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run src/renderer/src/lib/activity-details.test.ts src/renderer/src/lib/orbit-transcript.test.ts src/shared/ui-preferences.test.ts --maxWorkers=1 --fileParallelism=false
```

其余在根目录执行，GUI均串行：

```powershell
node scripts/orbit-stability-smoke.mjs --baseline
pnpm.cmd build
node scripts/orbit-stability-smoke.mjs
node scripts/information-disclosure-smoke.mjs
node scripts/chat-scroll-smoke.mjs
node scripts/v131-pane-regression-smoke.mjs
pnpm.cmd typecheck
pnpm.cmd lint
.\package-win.cmd --check
```

基线使用本轮修复前已经存在的生产out，新构建之后不再重建旧版本。稳定性专项先完成一轮修复后执行；视觉复核发现800px截图仍打开侧栏遮罩后，仅修改该矩阵截图前的真实收回按钮操作，再完整重跑并覆盖`final`。性能段位于此操作之前且完全不变；基线800px保留抽屉，最终800px在抽屉和遮罩退出后测量。最终仍为48条记录，其中35组布局快照、10次输入区滚动可达性测量、3条工具详情DOM及阅读位置记录。

### 同机场景对照

保留结果位于`.impeccable/review/orbit-stability/baseline/result.json`及`final/result.json`。夹具包含373条初始历史、180个`view_image`调用，每个调用约8KB参数及16KB输出，另有约2MB合成图像字段和完整长错误；自动记忆、MCP及网络重试关闭。每个性能阶段各8次CDP输入，流式阶段另有80段本地SSE，保留一条展开的历史工具详情。

| 指标 | 修复前基线 | 最终修复后 |
| --- | ---: | ---: |
| 空闲输入响应经验P95 | 105.7ms | 11.0ms |
| 流式输入响应经验P95 | 200.7ms | 9.4ms |
| 空闲阶段累计JS执行 | 643.1ms | 16.7ms |
| 流式阶段累计JS执行 | 2997.7ms | 302.5ms |
| 两阶段长任务数 | 8 / 33 | 0 / 0 |
| 全折叠时已挂载工具正文 | 180 | 0 |
| 空闲测量前DOM节点数 | 10094 | 5594 |
| 采样容器越界记录 | 105 | 0 |

响应口径为renderer收到`input`事件至两次`requestAnimationFrame`的时间，并非硬件键入到实际像素显示的端到端延迟；每阶段只有8个样本，此算法下P95等于该组最大值。表格是最终保留的一次基线与一次修复后执行，不是多机、多轮统计或所有对话的固定加速承诺。基线105条越界记录来自21个关闭态样本各5个容器，不是105种独立Bug。

上述数据支持输入响应及累计JavaScript执行负担下降，不能泛称所有渲染指标下降。流式阶段布局耗时22.3→48.8ms、样式重算51.2→166.1ms；实际React提交批次未单独统计。流式结束瞬时JS堆76.8→133.1MB，采样仅在阶段开始前GC，结束未再次GC，也未做长期稳态或峰值测量；不能判断有无泄漏，亦不作为内存普遍降低的证据。

### 布局、内容与审查边界

- 覆盖光轨中文夜间1440×900及2048×1280、英文日间1040×680、中文夜间800×680，以及简约中文夜间1440×900、英文日间1040×680。反复用原生Enter开合长上下文错误，逐层记录位置、宽度和`scrollLeft`；展开时验证输入区内部滚到底仍可到达输入框，并恢复位置且不滚动聊天历史。
- 工具详情展开时验证完整参数、输出末尾标记、组收起再展开，以及流式期间相同展开节点与内部阅读位置保留。语言即时切换及两个合法新调用的requested→failed/completed更新通过。结束时从临时数据库核对工具调用数及指定历史输出、错误未变；合成图像字段仅作为大字段历史负载，未核对其最终逐字相等、图像解码或真实视觉模型质量。审查后收紧了脚本的范围说明及末尾通过标签，没有改变断言；标签修改后只做语法检查，未再运行GUI，已保存JSON中的旧标签不能扩大解释为所有字段的最终校验。
- 独立源码复核未发现阻断问题，并指出重复结果测试夹具无效；脚本已改为新调用后接首次结果，未修改产品的结果关联规则。主流程实际打开最终代表截图；独立视觉复核打开用户参考及8张指定图，随后重新打开补采800px两图，确认无横向偏移和重叠，收起后输入控件可读。展开时输入区位于自身滚动区下方，已有可达性断言覆盖。
- 没有为收尾重复Impeccable detector；沿用本日首轮context/detector的一次结果，不把历史全量测试算作此次重跑。全部GUI使用独立临时profile、项目及本地模型，不访问正常用户DB、Key、记忆或系统剪贴板；复制断言只替换隔离renderer的clipboard方法。
- 本轮没有生成解包、NSIS或ZIP，未安装、执行云SQL、提交或推送。版本仍1.3.1，schema7、永久迁移、政策修订号和原子图标不变；旧1.3.0包及SQL元数据继续保留。Windows原始`spawn("npm.cmd")`兼容问题仍未在本轮修复；完整Windows/DPI、GPU、第三方网关和长期崩溃原因未认证。

正常退出旧实例后，仍通过根目录`.\run-experimental.cmd`启动已重建的1.3.1实验版。

## 2026-11-10 补充：输入框 Markdown/LaTeX 粘贴显示

用户要求保持1.3.1，在输入框粘贴Markdown、LaTeX及数学公式后直接显示对应格式，并能在设置中开关。本轮沿用现有Marked、KaTeX和DOMPurify，没有新增依赖或迁移。版本、schema7、永久迁移、政策修订号`2026-11-04.3`、原子图标和固定TencentDB上游资源不变。

### 实现与交互

- `ChatView`保留原生textarea作为草稿来源，文字粘贴沿用浏览器默认插入及undo栈。粘贴完成后在同一输入区域显示Markdown/公式，原生编辑器保留挂载并隐藏，不把渲染后的HTML写回草稿。
- 输入框底栏新增原文和预览图标，具有中英文标签、悬停提示及选中状态。Esc、直接输入及Shift+Enter可同步返回原文编辑；Enter保持发送行为，Ctrl+Z/Y及继续粘贴使用原生编辑路径。Ctrl+A返回原文并仅全选草稿；预览中的第一次Ctrl+X只切回原文，防止旧隐藏选区被误剪。右键预览返回原文、收拢旧选区并打开现有编辑菜单。
- 发送保留原始Markdown/LaTeX及内部空白，沿用既有首尾空白清理。图片粘贴仍作为附件；程序设置草稿、切换会话及发送后清空会复位预览状态。空或不支持的粘贴不会让后续普通输入误入预览；设置重新开启时不会抢走复选框焦点。
- `composer-markdown.ts`复用共享公式扩展，支持`$...$`、`$$...$$`、`\(...\)`、`\[...\]`及单美元独占行公式块；代码中保留字面字符。没有分隔符的任意TeX不自动猜测。修复共享行内公式将转义美元误判为闭合符的问题，并增加货币与转义组合回归。
- 预览转义原始HTML，链接只显示文字、图片语法只显示替代文字，插入DOM前再次净化；不会激活链接、脚本、样式或远程媒体。渲染前限制30000字符、1024个解析节点和128个公式，超限或解析失败保留完整可编辑原文并显示状态，不截短发送内容。
- 全局`ui.preferences.composerRichPaste`默认开启，旧配置自动获得默认值，显式关闭会保留；旧客户端保存缺省字段时沿用当前值。设置 → 外观与语言 →“粘贴时显示 Markdown 和公式格式”立即生效并自动保存。两种风格共用现有颜色及布局，预览内部滚动，高度上限为240px与视口30%中的较小值。

这是格式显示与原文编辑两种状态，未引入可直接编辑公式结构的富文本编辑器；中英文手册已明确操作与范围。

### 最终源码与资源检查

| 检查 | 此次补充实际结果 |
| --- | --- |
| 定向Vitest | `composer-markdown`、`math-markdown`、`ui-preferences`及`clipboard-images`，4文件25项通过，1.05秒；未重跑完整Vitest |
| TypeScript | Node/Web两套通过 |
| Biome | 最终295文件通过，无自动改写 |
| 生产构建 | main102/preload3/renderer2227模块通过，25个固定TencentDB源模块哈希通过；实验out与中英文内嵌手册、更新日志已更新 |
| 用户入口预检 | `package-win.cmd --check`通过33项资源、生产依赖和1.3.1核对 |
| 静态检查 | smoke脚本语法与`git diff --check`通过；仅有既有LF/CRLF提示 |

定向测试在`apps/desktop`执行：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run src/renderer/src/lib/composer-markdown.test.ts src/renderer/src/lib/math-markdown.test.ts src/shared/ui-preferences.test.ts src/renderer/src/lib/clipboard-images.test.ts --maxWorkers=1 --fileParallelism=false
```

其余命令在仓库根目录执行：

```powershell
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
.\package-win.cmd --check
node --check scripts/composer-rich-paste-smoke.mjs
node scripts/composer-rich-paste-smoke.mjs
git diff --check
```

### 真实 Electron 回归

新增`composer-rich-paste-smoke.mjs`最终11组通过、1次本地模型请求、8张截图、6组布局矩阵；renderer异常、崩溃事件、服务端错误及禁用的renderer网络请求均为0，退出0。结果位于`.impeccable/review/composer-rich-paste/result.json`。

| 范围 | 实际覆盖 |
| --- | --- |
| 默认格式化 | 同一输入区展示标题、加粗、列表、表格、代码及KaTeX，隐藏原始符号，同时保留完全相同的草稿 |
| 编辑与键盘 | 原文/预览、Esc、直接输入、选区替换、原生撤销/重做、草稿范围Ctrl+A、第一次Ctrl+X保护及真实CDP右键菜单 |
| 输入与粘贴边界 | 模拟中文组合输入、预览中继续粘贴、空及不支持的HTML-only粘贴后普通输入不自动格式化 |
| 发送 | 预览Enter只发起一次请求，模型收到原始Markdown/LaTeX及内部空白，随后清空草稿 |
| 设置 | 对已有草稿立即关闭、保留文字、页面重载后仍关闭、可以重新开启且设置焦点保留 |
| 内容与资源 | 原始HTML、媒体、样式、脚本及链接保持惰性；无效公式可回原文修正；超30000字符草稿完整保留且可继续输入；图片附件添加/移除不替换文字 |
| 两种风格 | 简约/光轨各覆盖中文夜间1440×900、英文日间1040×680、中文日间800×680；预览内部滚动、底栏和发送按钮保持在窗口中 |

最终截图为`simple-zh-night-1440.png`、`preview-context-menu-zh-night.png`、`setting-off-zh-night.png`、`simple-en-day-1040.png`、`simple-zh-CN-day-800.png`、`orbit-zh-CN-night-1440.png`、`orbit-en-day-1040.png`及`orbit-zh-CN-day-800.png`，均在上述结果目录。主流程已实际打开简约中文夜间、光轨英文1040、光轨中文800和设置关闭截图查看像素；另一名独立审查者逐张打开全部8张最终截图，确认公式、预览内部滚动、切换控件、发送按钮及设置项可见，未发现偏移或阻断问题。该静态视觉复核没有重新运行GUI或据此宣称动态焦点、发送已验证。独立源码复核此前发现预览右键、全选/剪切、设置焦点及粘贴标记问题，修复后均加入最终桌面回归；最终只读复核未发现阻断问题。

### 失败尝试与验证边界

- 最初单元测试发现转义美元结束公式的真实问题，已修改共享解析器并增加回归；未知TeX命令的测试误以为必然生成`katex-error`，实际KaTeX会显示红色命令文本，夹具改为缺失参数花括号的真实无效公式，未为适配断言修改产品行为。
- 首次桌面执行在传输断言中把Responses文字`content`当成数组而抛错；改为按实际协议接受文字字符串或`input_text`数组并严格比较来源，最终11组完整重跑通过，没有减弱原文保持断言。
- 粘贴使用合成`ClipboardEvent`与`DataTransfer`，同步交由浏览器`document.execCommand('insertText')`走原生编辑路径；键入、撤销、选区及组合输入经CDP。覆盖应用粘贴处理与浏览器编辑，不等于真实Windows剪贴板Ctrl+V、物理中文输入法或完整辅助技术/DPI/GPU认证。未验证主进程接收发送前的IPC失败；模型HTTP失败发生在请求接受后，不能用来证明发送前草稿恢复。
- 测试使用独立临时profile、项目及本地SSE，不访问正常用户DB、Key、记忆或系统剪贴板，不调用付费模型。没有生成解包应用、NSIS或ZIP，没有安装、升级、执行云SQL、Git提交或推送；旧1.3.0安装包及发布SQL继续保留。
- 没有为收尾重复Impeccable context或detector，也没有将历史完整测试或上一节的性能数字计为此次结果。

最终实验out已重建。正常退出托盘中的旧实例后运行根目录`.\run-experimental.cmd`，已有out时入口不会自动重新构建。

## 2026-11-10 至 11 补充：所有待发送会话保存草稿

用户要求保持1.3.1，新会话及已有历史会话在切出去再切回来、重启软件后仍保存待发送内容，直到用户手动删除或发送。此前仅组件存活时保留的草稿不足以覆盖正常退出，本轮加入每会话持久保存和退出协调。schema7、全部永久迁移、政策修订号`2026-11-04.3`、图标和TencentDB固定上游资源保持。

### 实现与数据范围

- `shared/composer-draft.ts`定义原文、`formatted`、附件引用及通知合并回执。SQLite `app_settings`使用`composer.draft.<sessionId>`和独立`composer.draft-attachment.<sessionId>.<id>`，保存完整附件字节；元数据、附件增删在同一savepoint提交。附件继续校验类型、实际base64长度与25MiB单文件上限，不把原路径当作保存完成。
- `composer-drafts.ts`及`use-composer-draft.ts`保存每会话状态和写入队列，ChatView卸载不清队列。恢复不会以迟到旧读取覆盖用户输入；UUID revision区分不同写入及发送版本。原始文字和内部空白、原文/格式预览状态、附件在切换及正常重启后恢复，发送仍按既有规则处理首尾空白。
- 接受消息时插入消息和CAS消费草稿在同一Repository事务。接收前IPC失败保留草稿，已接受发送的迟到回执只能消费原revision；用户回来后新写的内容及其他会话的草稿保留。手动删除文字/附件会保存结果，已清空内容不会在重启时复活。
- `composer-draft-flush.ts`在退出、界面reload及更新交接前等待renderer持久化。保存失败会取消操作、恢复可用窗口、显示可重试错误；不能在数据库关闭后补写。持久composer草稿不再直接阻塞风格重载；文件/历史消息/计划编辑在请求前及真实`beforeunload`均检查，包括等待保存时才产生的编辑。并发重载请求去重，晚到的composer输入保存后由主进程重新检查活跃任务、退出及更新状态；仅正常退出及已提交的更新退出取消旧重载意图，更新预检保存不取消。
- 失败通知快捷回复先持久排队，合并时记录receipt，防止切换、reload、重启、清空后重复追加。自动保留期保护带草稿会话及其父会话；显式删除会话清理对应草稿和附件。此功能不扩大为文件编辑、未提交结构化提问选择或任意输入框的持久化。

### 实际检查

| 检查 | 本轮实际结果 |
| --- | --- |
| 草稿定向Vitest | 重载保护补丁前4文件、67项通过；覆盖Repository事务及CAS、renderer队列、flush和保留期 |
| 重载保护定向Vitest | 最后主流程重跑4文件、39项通过，2.22秒；覆盖晚到的编辑、保存失败重试、重复请求、主进程重检及退出/更新交接；与上行有重叠，不相加 |
| 真实Electron草稿专项 | 最后构建后重跑10组通过；4次启动、4次正常退出、3次本地模型请求、4张截图、4条测量 |
| 真实Electron界面专项 | 最后构建后20组通过；2次启动、2次本地请求、40张截图，renderer异常0 |
| 异常与资源 | renderer异常、崩溃、服务端错误及禁用网络请求数组均为空 |
| 最终格式粘贴回归 | 同一构建重跑11组通过、1次本地请求、8张截图、6组几何矩阵；上述异常数组均为空 |

草稿结果为`.impeccable/review/composer-drafts/result.json`，格式粘贴结果为`.impeccable/review/composer-rich-paste/result.json`，不与上一节的同名历史运行重复相加。界面专项结果为`.impeccable/review/interface-style-result.json`。

最终重载定向命令在`apps/desktop`执行：

```powershell
pnpm.cmd exec vitest run src/renderer/src/lib/use-composer-draft.test.ts src/main/desktop/composer-draft-flush.test.ts src/main/desktop/interface-reload.test.ts src/shared/ui-preferences.test.ts --maxWorkers=1 --fileParallelism=false
```

| 草稿场景 | 实际覆盖 |
| --- | --- |
| 新旧会话 | 新空会话与完成过一轮的旧会话分别保存精确原文，切换后各自恢复 |
| 真实正常重启 | 关闭并启动应用后恢复原文、预览状态和两个完整附件；重启前已删除附件原文件 |
| 两种风格 | 简约中文夜间、光轨英文日间，1440及800宽度下原文、公式预览和附件控件可读 |
| 接受发送 | 实际保存消息和附件，仅清目标revision，另一待发送会话保持 |
| 迟到回执 | 延迟已接受发送的回执，切换回来写新草稿后旧回执无法清掉新内容 |
| 保存失败 | 注入草稿写入失败，退出被取消且窗口可继续操作；重试后持久保存并正常退出 |
| 接收前失败 | 注入发送前IPC拒绝，保留未发送草稿；手动清空后重启仍为空 |
| 最后输入与通知 | 退出前的最后编辑保留，失败快捷回复只合并一次；切换、reload及再次重启不重复，清空后不复活 |
| 实际风格重载 | 仅在显式应用时重载，恢复完全相同的原文、公式预览及附件字节，不发送消息 |
| 重载保存失败 | 注入本地草稿保存失败，保留窗口中新输入及原持久快照；存储恢复后可用同一操作重试 |
| 晚到的编辑 | 等待草稿保存时实际修改文件，`beforeunload`阻止重载；原磁盘内容、窗口和未保存编辑保留，草稿仍保存，清理后风格往返成功。既有文件、消息、计划和运行中保护也通过 |

可在根目录串行复现桌面流程：

```powershell
node scripts/composer-drafts-smoke.mjs
node scripts/composer-rich-paste-smoke.mjs
node scripts/interface-style-smoke.mjs
```

持久草稿加入后的首轮格式粘贴回归没有通过：旧夹具在恢复的格式预览态直接向隐藏textarea输入。脚本改为展示矩阵前通过真实操作清草稿、等待输入就绪，然后完整11组重跑；没有用产品兼容分支隐藏问题，也没有去掉原文保持/发送断言。最终800px光轨及1040px简约代表截图另经独立审查实际查看，预览、附件和发送控件未被挤出窗口。

界面专项此前一次已通过3个新增保护场景，后续语言/主题矩阵的`Page.reload`却先读到旧页面。夹具改为等待新的页面代际，再完整20组重跑通过，没有因夹具修改产品。重载保护另经独立只读终审，无阻断；不将独立审查作为额外测试次数。

以上证明正常退出和受控保存错误下的持久化，不保证掉电、进程强杀、磁盘损坏或多个实例竞争时绝对零丢失。GUI使用自有临时profile、项目和本地SSE；未访问正常用户DB/Key/记忆、系统剪贴板或付费模型。没有生成安装包、安装、执行云SQL、Git提交或推送。

## 2026-11-10 至 11 补充：原生公式、Markdown 与文档制作工具

用户要求联网核对并补齐文档工具，重点解决Agent处理Markdown/LaTeX时只能写带符号文字、不能插入Word原生可编辑公式的问题。本轮扩展既有`create_document`和回读能力，保留1.3.1及现有文件权限链路。官方一手资料、格式能力、JSON例子和容量限制见[文档工具说明](DOCUMENT_TOOLS.md)；本节记录实际证据，不将任意Office或完整TeX支持作为验收承诺。

### 实现与格式边界

| 格式 | 本轮支持 | 明确边界 |
| --- | --- | --- |
| DOCX | 原生OMML公式、富段落/行内公式、Markdown、代码/引用、目录、脚注、页眉页脚/页码/边距、模板填充、原生图表及内嵌XLSX数据 | 目录/页码为原生域，准确页码需Word更新；不支持完整TeX及任意旧稿的无损编辑 |
| PDF | 公式、Markdown、富段落、代码/引用、页眉页脚/页码/边距，保留已有表格和图片 | 输出排版结果；不提供Word原生编辑公式，图表/目录/脚注块本轮未开放 |
| PPTX | 原生图表/内嵌XLSX，保留已有幻灯片、文字、表格、图片、备注及定位框 | 明确拒绝新增公式、Markdown和富段落块 |

`document-rich-content.ts`复用现有`docx@9.15.3`的`latexToMath`、`htmlToContent`及图表能力；模板使用`patchDocument`。新增直接生产依赖`@xmldom/xmldom@0.8.15`用于结构化XML检查。Markdown使用受限Marked实例，原始HTML转义；代码中的公式保持原文，Markdown图片地址不读外网，工作区图片仍逐个经过受控读取。

未知或无效LaTeX明确报错，不回退成图片/带符号原文，也不提交部分输出；常见分式、根式、上下标、积分、求和、矩阵、cases和aligned有覆盖，不加载任意宏包。`read_document`对OMML提供有界线性文字摘要，二维公式位置与分页仍需实际排版引擎核对。

模板占位符必须唯一、独占普通段落，允许跨run。修订、书签、批注、字段、绘图、内容控件及分节等保护结构拒绝替换。宏/数字签名除文件名检查外，解析带XML命名空间的`[Content_Types].xml`及`.rels`声明，覆盖改名部件；最后补丁新增4个使用非标准部件名的合成fixture。默认另存，媒体填充仅支持单节单栏、有明确纸张及边距的正文位置，按实际可用宽高限制；纯文字/公式不受同一媒体限制。模板`font`用于新增的直接文字块，Markdown/列表沿用模板样式，代码和公式使用各自字体。自定义边距同样约束新文档媒体，负值柱/条形轴包含零，饼图保留类别图例。

既有Plan、profile、patch-only、审批、隔离、Memory目录保护、writer lease、外部文件hash冲突、取消和原子提交均继续生效；公式支持不代表新增任意文件访问或宏执行资格。

### 最终源码与包资源检查

| 检查 | 实际结果与口径 |
| --- | --- |
| 文档定向Vitest | 最后模板声明保护及fixture修正后，5文件100项通过，9.46秒，退出0 |
| TypeScript | 最后重载修复后Node/Web两套通过 |
| Biome | 最终306文件通过，628ms，无自动改写 |
| 最终生产构建 | 2026-11-11重载修复后的`pnpm.cmd build`退出0，main106/preload3/renderer2229模块通过，25个固定TencentDB源码哈希通过 |
| 资源预检 | 最终`package-win.cmd --check`退出0，通过33项资源、生产依赖、当前1.3.1版本及固定上游哈希检查 |
| 真实ASAR文档检查 | 2026-11-11对当前构建最新重跑退出0；包内原生OMML/Markdown/图表/工作簿、KaTeX MathML、DOCX/PPTX制作及隔离依赖闭包通过，禁止宿主回退，独立profile/外网阻断；离线中英OCR、PDF页面及旧DOC检查通过 |
| 受保护内容 | schema7及永久迁移、政策修订号`2026-11-04.3`、既定图标和25份TencentDB源哈希保持 |

最新ASAR检查的首次受限执行失败：Electron `install_dir_access.cc`报sandbox token ACL无法读取运行时，退出2147483651。未修改ACL或node_modules；同一`node scripts/document-asar-smoke.cjs`命令经适当执行权限重跑退出0，得到上表结果。该专项不生成正式包或安装器，不能替代安装器验收。

全量Vitest与进程权限补验分开记录，不能把两次有重叠运行的数字相加：

- 首次完整运行112文件通过、3文件失败、4文件环境跳过；1315项通过、6项失败、10项跳过，307.91秒，另记录1条未处理进程清理拒绝。此命令没有通过。
- 失败集中在sandbox下的进程取消/收尾；在权限适当的环境重跑`plugin-hook-service.test.ts`、`persistent-command-service.test.ts`和`tool-cache-index.test.ts`，3文件35项通过、15.18秒，退出0且无未处理错误。记录保留原失败，不能据此声明一次完整全量全绿。
- 证据为`.impeccable/review/v131-final-vitest.json`及`.impeccable/review/v131-process-vitest.json`。

8个打包/图标Node测试文件共有58个不同用例，首轮55通过/3失败，失败为BuildCache创建临时目录的`mkdtemp EPERM`。随后在权限适当环境重跑`package-native-copy.test.cjs`，4项通过，覆盖完全部58个不同用例；4项与首轮有重叠，不能报成59项或把首轮命令写成成功。

最后静态检查先发现新声明fixture中的TypeScript `undefined`及单行格式问题，修正后才得到上表最终结果；没有跳过类型或格式检查。新增直接依赖后pnpm曾报告已安装importer元数据不同步，离线install因无TTY拒绝移除modules而中止，lockfile-only已成功，实际依赖闭包可解析且测试通过。最终命令使用当前进程的`pnpm_config_verify_deps_before_run=warn`，没有清空node_modules、手改安装元数据或永久关闭校验；后续应在允许的终端正常同步依赖。

相关文档定向命令在`apps/desktop`运行：

```powershell
pnpm.cmd exec vitest run src/main/documents/document-author.test.ts src/main/documents/document-creation-tools.test.ts src/main/documents/document-pdf.test.ts src/main/documents/document-rich-content.test.ts src/main/documents/document-extractor.test.ts --maxWorkers=1 --fileParallelism=false
```

### 真实 Electron 文档链路

最终构建后的结果为`.impeccable/review/v131-document-authoring-1794359279344/result.json`：12项通过，33次Agent请求、0次辅助请求、5张截图，使用合成文档和本地SSE。实际执行`create_document`/`read_document`，不是只在测试中直接调用序列化库。当天一次权限受限的执行因renderer调试端口9401未就绪而超时，`.impeccable/review/v131-document-authoring-1794357168575`未产出结果，不计为通过；在权限适当的环境中完整重跑后得到上述结果。

| 范围 | 实际结果 |
| --- | --- |
| DOCX基础链路 | 中文、原生表格、本地图片、Letter纸张、分页、默认拒绝覆盖及显式覆盖成功 |
| DOCX扩展 | 8个OMML公式、15个关系、1个图表及1个内嵌工作簿；Markdown、脚注、目录、页码域存在 |
| 模板填充 | 原模板未变，保留周边文字/页眉/旧脚注，新增公式、图表、脚注、列表、链接；15个关系及1套图表/工作簿 |
| PPTX | 中文、表格、图片、两张幻灯片、备注；原生图表和内嵌数据，20个关系完整 |
| PDF | 基础文档和公式文档各2页；可选中文字，表格/图片、公式/Markdown、页眉页脚/计数保留，渲染页面非空 |
| 失败保护 | 不支持的LaTeX返回具体错误且不生成原文/图片替代品；真实请求批准拒绝不落盘、权限不变 |

命令在仓库根目录，GUI串行：

```powershell
node scripts/document-authoring-smoke.mjs
node scripts/document-asar-smoke.cjs
```

### 原生 Word 与像素复核

文档GUI的DOCX截图为语义HTML，不能用于证明Word分页。前一次成功文档运行另外调用本机Microsoft Word COM打开生成文档、导出PDF并渲染PNG，单独证据为`.impeccable/review/v131-document-authoring-1794317520545/word-render/result.json`；最终GUI重跑未重复Word COM：

- `native-math.docx`：8个原生公式、3页、1个脚注。
- `filled-template.docx`：1个原生公式、1页、2个脚注。
- 实际将第一个公式编辑为`z^2+1`、保存并重新打开，原生公式仍保留。Markdown文字的空白通过Word实际读取确认，`nativeEquationEditSaveReopen`和`markdownWhitespacePreserved`均为true。

可复用的开发QA入口为`scripts/document-office-render-smoke.ps1`；Word仅用于这项可选验证，产品生成和读取文档不依赖Office安装。它不等于所有Word/PowerPoint版本或复杂第三方模板的兼容认证。

视觉复核发现PDF连续独立公式的上下标和积分过于拥挤，已为公式块增加间距及分页保护，重新生成并查看最终页面。怀疑Word斜体边界缺空格后，XML确认保留空白，增加回归并由Word原生读取验证通过。最终独立审查者实际打开8张PNG，含6张文档（修复后PDF与Word）及2张composer；未发现阻断问题，PDF嵌套列表留白偏大为非阻断观察。该审查只读图片，没有再次运行GUI，也不据截图扩张动态交互覆盖。

主流程另实际查看最后构建的3张代表图：光轨重载后公式预览和附件、晚到文件编辑保留、最新文档GUI的公式PDF第1页。内容可读、主要控件和公式间距正常；此检查与前次Word原生编辑证据分开记录。

### 交付边界

README、双语USER_GUIDE/CHANGELOG、tools提示、第三方清单、AGENT和本记录同步。通用工具提示也按现有配置校正了TencentDB主备模型说明，固定官方提示词未改。2026-11-11最终生产out已重建，界面、草稿、格式粘贴和文档GUI均串行重跑；`package-win.cmd --check`最终通过33项资源/生产依赖/1.3.1版本。构建和预检仍有上文已披露的importer警告，使用的`verify_deps_before_run=warn`只在执行进程生效。正常退出旧实例后运行根目录`.\run-experimental.cmd`；已有out不自动重新构建，后续修改源码或内嵌文档仍应先执行`pnpm.cmd build`。

全部验证只操作自有临时profile、项目和合成文档，本地SSE不消耗付费模型。没有读取或修改正常用户DB/Key/记忆/系统剪贴板，没有生成新的完整解包应用、NSIS或ZIP，没有安装/升级/卸载、上传、执行云SQL、Git提交或推送。真实ASAR smoke是包内依赖证据，不能替代正式安装器验收；现有1.3.0安装包、ZIP及SQL继续保留实际版本和元数据。完整TeX、通用Office编辑器、所有Windows/DPI/Office组合、第三方付费模型语义质量和长期崩溃原因均未认证。

## 2026-11-11 补充：按文件夹批量管理会话

用户要求保持1.3.1，在设置中按工作文件夹批量勾选会话，支持删除和归档。入口为设置 → 会话与数据 → 按文件夹管理会话；同时支持恢复归档。schema7、永久迁移、政策修订号`2026-11-04.3`、原子图标、TencentDB固定资源及此前未提交修改保留。

### 实现与范围保护

- `SessionManagementSettings.tsx`提供工作文件夹、未归档/已归档/全部范围、主会话标题搜索、逐项复选、半选、跨全部匹配页全选及逐项操作结果。每页50个主会话、列表独立滚动；翻页保留选择，切换文件夹、状态或搜索清空选择。仅有归档会话的文件夹、同名不同路径文件夹及无工作区会话均可管理。
- `session-management.ts`独立读取完整分页目录，以主会话为选择单位，核对其全部后代，包括不同worktree目录的子任务。确认框显示实际主、子会话数量，不把侧栏已加载子集当成完整范围。
- 每个父ID的两种归档范围及其分页必须形成同一revision的稳定快照。仅revision漂移时废弃该父ID的所有页并完整重读，最多3次尝试；total、身份和重复cursor等错误立即拒绝，稳定revision下仍核对完整计数。确认后执行再次比较集合与身份，范围变化提示刷新。
- typed IPC/preload沿现有更新/删除方法传递可选`SessionBatchTarget[]`，仅包含ID、父ID、工作区及归档状态。主进程`session-batch-guard.ts`精确核对整树；删除复用现有停止任务及快照等待后的回调反复检查，拒绝新增、移动或身份变化。本次递归已删除成员可缺失，但移到树外且仍存在的成员不能当作已删除。
- 归档保留草稿和附件、暂停关联定时任务，并沿用忙碌树限制；恢复不自动重新启用定时任务。永久删除先停止并等待运行结束，清理消息、草稿、附件及应用快照，保留项目文件，复用现有失败保护。
- 每项独立执行，成功结果保留，失败原因逐项显示，只有失败项继续勾选供重试。核对、确认和执行期间锁定设置导航、关闭、Esc及遮罩；真实`browser_open_requested`事件也不能卸载忙碌的设置页。不是整批事务，不对已成功项做自动回滚。

### 源码、构建及资源检查

| 检查 | 本轮最终结果 |
| --- | --- |
| Renderer helper定向Vitest | 1文件22项通过，470ms，包含稳定快照、分页完整性、范围变化及选择行为 |
| 主进程守卫定向Vitest | 1文件20项通过，2.79秒，含5个真实SQLite及ChatService集成用例；5项包含在20项中 |
| 相邻行为定向Vitest | 5文件58项通过，3.80秒，覆盖会话目录、保留期、会话服务、草稿存储及会话导航 |
| Node/Web TypeScript | 最终两套通过，退出0 |
| Biome | 最终311文件通过，456ms，退出0 |
| 生产构建 | 最终`pnpm.cmd build`退出0，main107/preload3/renderer2231模块通过，25个固定TencentDB源模块哈希通过 |
| 用户入口预检 | 最终`package-win.cmd --check`退出0，33项资源、生产依赖及1.3.1版本通过 |
| 静态检查 | `git diff --check`及smoke脚本语法通过；保留既有LF/CRLF提示 |

以上为分开运行的7个文件、100个不同定向用例，不包含独立复核时重复执行的集成子集。没有重跑完整仓库Vitest，也不沿用第36、37节的全量或GUI数字作为本轮结果。

定向入口可分别在`apps/desktop`执行：

```powershell
pnpm.cmd exec vitest run src/renderer/src/lib/session-management.test.ts --maxWorkers=1 --fileParallelism=false
pnpm.cmd exec vitest run src/main/sessions/session-batch-guard.test.ts --maxWorkers=1 --fileParallelism=false
pnpm.cmd exec vitest run src/main/sessions/session-catalog.test.ts src/main/sessions/session-retention-service.test.ts src/main/sessions/session-service.test.ts src/main/storage/repository-composer-draft.test.ts src/renderer/src/lib/session-navigation.test.ts
```

构建及桌面入口在仓库根目录：

```powershell
$env:pnpm_config_verify_deps_before_run='warn'
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
.\package-win.cmd --check
node --check scripts/session-management-smoke.mjs
node scripts/session-management-smoke.mjs
git diff --check
```

已有的pnpm importer安装元数据不同步警告仍保留，`warn`只在执行进程生效；没有删除node_modules、手改安装元数据或永久关闭校验。实际生产依赖和资源预检通过，后续仍应在允许的终端正常同步依赖。

### 真实 Electron 验收

最终`session-management-smoke.mjs`完整退出0，证据为`.impeccable/review/session-management/result.json`：11/11组通过、2次启动及2次正常退出、1次实际本地SSE请求、12张截图及12条几何记录；renderer异常、崩溃、服务端错误和禁用外网请求均为0。

| 场景 | 实际结果 |
| --- | --- |
| 完整目录与跨页选择 | 255个主会话跨200条IPC分页边界及六个50项UI页面，逐项、半选、全选、翻页保留和筛选清空通过；不同路径同名文件夹、仅归档文件夹及无工作区会话可区分 |
| 全部后代计数 | 207个后代包含205个同状态直属子项、归档worktree子项及孙项；确认框完整计数，取消删除未改变数据 |
| 归档与恢复 | 255个主会话及207个后代全部成功；草稿revision、原文、格式状态和附件完整字节精确保留，定时任务归档后暂停，恢复后仍暂停 |
| 永久删除 | 完整208项会话树删除，清理草稿、附件、关联任务和应用快照，项目文件及另一文件夹保持；另删除运行中的根及子会话，本轮合计210个ID |
| 失败恢复 | 注入单项归档失败，显示该项原因，仅失败项保留勾选，重试不重复成功项；实际IPC目录读取失败可通过刷新恢复完整列表 |
| 操作期间保护 | 延迟归档回执时，导航、关闭、Esc、遮罩和真实运行时浏览器事件均不能离开批次 |
| 运行中删除 | 本地Responses SSE保持运行，真实删除路径取消并等待请求关闭及子项删除，另一对话仍可使用 |
| 两种界面 | 简约/光轨分别覆盖中文夜间1440、英文日间1440、中文日间800、英文夜间800；中英文确认框及失败状态正常 |
| 退出与存储 | 最终SQLite为schema7、integrity为ok、foreign key无违例、孤立草稿0，剩余261个会话；正常退出后临时进程与目录均已清理 |

12条几何记录包含目录读取错误页，该页没有正常会话行，仅记录错误状态；不将其说成完成了与正常列表相同的行几何断言。独立审查者实际重新打开全部12张最终截图，路径标识与成功运行一致，无阻断的遮挡、横向溢出或标题不可读；主流程另实际查看最终800px光轨英文夜间和英文删除确认图。静态视觉结论不替代上述动态交互验证。

### 失败尝试与交付边界

- 首次受限执行renderer调试端口未就绪，同一命令经允许的执行权限重跑；未修改ACL或运行时。证据保留为`result-first-launch-failed.json`。
- 桌面实测发现真实产品问题：全局目录revision也会因普通lastOpened更新变化，归档当前会话触发自动切换时，255项中254项成功、1项误报范围变化。已改为仅revision漂移时完整重读稳定快照，保留集合、身份及计数保护，并增加回归；最终255项归档/恢复完整通过。原失败保留为`result-archive-revision-failed.json`。
- 另有三次夹具失败：运行会话ID不符合UUID要求，以及两次在异步核对或确认框完整挂载前读取DOM。脚本改用合法UUID，并集中等待可见确认框、非空说明和完整动作按钮；没有放松强断言或为夹具修改产品。分别保留`result-fixture-uuid-failed.json`、`result-dialog-wait-fixture-failed.json`、`result-running-confirm-wait-failed.json`，不得将首轮描述为全通过。
- 真实GUI仅操作自建临时profile、项目、本地SSE及合成SQLite夹具，DOM点击与CDP键盘输入不等于物理输入或完整辅助技术认证；未访问正常用户DB、Key、记忆或系统剪贴板，无付费请求。未认证任意掉电、多实例、全部Windows/DPI/GPU组合或大规模操作的性能收益。
- README、双语手册及更新日志、DESIGN、AGENT和本验证记录已同步。实验out及内嵌手册已在最终构建更新，正常退出旧实例后运行`.\run-experimental.cmd`；只有本验证记录及交接说明在最后验收后补记，无需因此重建。
- 本轮未生成正式解包应用、NSIS或ZIP，没有安装、升级、执行云SQL、Git提交、推送或发布。现有1.3.0包及发布元数据保留真实版本，资源预检不等于安装器验收。

## 2026-11-11 补充：供应商排序与模型星标

用户要求保持1.3.1，设置左侧和Chat模型菜单可长按拖动供应商排序，每个模型可星标，所有模型选择入口顶部共用可折叠的“星标模型”组，显示“模型 ID（供应商名）”，并同步文档。schema7、永久迁移、政策修订号`2026-11-04.3`、原子图标及固定TencentDB资源保留。

### 实现与数据范围

- `shared/model-catalog.ts`和`main/providers/model-catalog-service.ts`通过typed IPC/preload读写既有`app_settings`键`ui.modelCatalogPreferences`，只保存供应商配置ID顺序和模型配置ID星标。逐项移动/设星操作合并最新偏好；同网络Model ID的不同供应商配置可以分别收藏。没有重排Repository的供应商查询、模型表或Key优先级，也不修改已有会话、默认模型、主备模型或Agent继承。
- `model-catalog-store.ts`及根级`ModelCatalogPreferences.tsx`共享读取及串行保存回执，迟到读取不能盖掉新提交。保存失败保留已保存状态，重试原来的精确操作；删除模型或供应商成功后重新读取并作废旧失败操作，刷新失败改为重试读取，避免反复提交已经删除的目标。
- 设置供应商名称行/手柄及模型菜单供应商标题可长按340ms拖动；短点不排序，提前移动保留滚动，支持边缘滚动、取消、失焦清理及拖后点击抑制。实际横向flex供应商列表按横轴排序，普通block菜单按纵轴。手柄支持Alt+方向键；保存时`aria-disabled`和事件守卫阻止新操作并保留键盘焦点。
- 共享`ModelPicker`覆盖Chat、新建会话、压缩全局/会话/备用、审批主备、记忆分析主备及子Agent共10个模型入口。星形按钮与模型选择分开；点星形不选模型、不关菜单，也不刷新未保存的设置表单。星标行按供应商展示顺序及供应商原有模型顺序排列，折叠组仍可在无星标时显示。
- 展示沿用各入口已经过滤的可用模型。禁用模型不能借星标变为可选，记忆分析文字能力及备用排除主模型的规则保留。暂时不可用保留收藏，真正删除配置才清对应偏好。保留清除、使用当前模型、继承主会话等原语义；星标组折叠状态未承诺跨重启保存。

### 源码、构建与资源检查

| 检查 | 本轮最终实际结果 |
| --- | --- |
| 定向Vitest | 8文件146项通过，2.84秒，覆盖供应商相关行为、共享/主进程Agent模型语义及renderer helper/store；store包含12项 |
| Node/Web TypeScript | 两套通过 |
| Biome | 320文件通过，1002ms，无自动改写 |
| 生产构建 | `pnpm.cmd build`退出0，main109/preload3/renderer2236模块通过，25个固定TencentDB源码哈希通过 |
| 用户入口预检 | `package-win.cmd --check`退出0，33项资源、生产依赖及当前1.3.1版本通过 |
| 设计检测 | 仅运行一次，`.impeccable/review/model-catalog-detector.json`为`[]` |

定向测试与此前142项、105项等运行有重叠，不相加，也不沿用前节全量或会话批量管理数字作为本轮结果。没有重新运行完整仓库Vitest。pnpm importer已安装元数据不同步警告仍保留，验证只使用进程级`pnpm_config_verify_deps_before_run=warn`；没有清空node_modules、手改安装元数据或永久关闭校验。

构建、检查和桌面入口在仓库根目录：

```powershell
$env:pnpm_config_verify_deps_before_run='warn'
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
.\package-win.cmd --check
node --check scripts/model-catalog-smoke.mjs
node --check scripts/agent-selection-smoke.mjs
node scripts/model-catalog-smoke.mjs
node scripts/agent-selection-smoke.mjs
git diff --check
```

GUI入口必须串行运行。上述Agent选择回归的最终运行结果在后文单独记录，不将命令列表本身当成通过证据。

### 真实 Electron 模型目录验收

最终`model-catalog-smoke.mjs`完整退出0。证据为`.impeccable/review/model-catalog/result.json`：10/10组通过，2次启动及2次正常退出，10种入口及重启后Chat共11份入口记录，10张截图及11条几何记录。renderer异常、崩溃、服务端错误和非本地网络请求均为0。

| 场景 | 实际覆盖 |
| --- | --- |
| 设置排序 | 真实CDP鼠标按下430ms后移动/松开，短点不排序，Esc取消，选择供应商不变；Alt+Down再Alt+Up无需重新聚焦 |
| 菜单排序 | 实际将中间供应商上下移动，菜单保持打开且不选择模型，设置及其他入口同步；800px设置横向列表真实长按横拖通过 |
| 独立星标 | 设置和菜单中星形不选择模型、不关闭菜单，未保存模型编辑保留；不同供应商的相同网络Model ID分别收藏 |
| 所有入口 | Chat1、新建1、压缩3、审批2、记忆2、Agent1共10个；可见顺序和星标同步，保留禁用、能力、主备排除与Agent角色限制 |
| 实际路由 | 从星标组选择供应商B的同名模型，1次真实本地Responses请求到B，发送网络`same-wire-model`，不是配置UUID |
| 保存失败 | 单次星标/排序写入失败保留已保存状态及当前模型，显示错误并重试精确操作；删除失败目标后废弃旧重试，重新读取失败也可重试恢复 |
| 重启及清理 | 正常退出后重新启动，排序、按配置ID星标及选中模型保留；供应商重命名更新星标标签，删除清偏好，空星标组仍可折叠 |
| 几何与滚动 | 简约/光轨分别覆盖中文夜间1440、英文日间1440、中文日间800、英文夜间800；长标签截断，手柄与星形独立，真实wheel使菜单内部滚动 |
| 数据库 | 最终schema7、integrity为ok、foreign key无违例；该项最终清空星标是删除测试的预期结果，重启保存断言在删除前完成 |

主流程及入口审计者已实际逐图打开全部10张最终PNG：设置排序、失败重试及8个主题/语言/尺寸矩阵均有效，无空白、标题错位或控件遮挡的阻断。800px光轨图中右侧工作区抽屉及遮罩为实际既有状态，模型菜单位于其上方；不是误把截图空白当成验收。超长供应商名称在设置左侧换行较多、旁边既有图标可缩小为非阻断观察，不扩大本轮为列表视觉重构。

截图只证明静态可见性，交互结果以上述实际脚本断言为准。

### 独立界面终审

当前工具没有暴露专用`impeccable_finish_reviewer`，因此使用未继承对话历史的通用独立代理代行只读终审。审查者实际打开全部10张必需截图，抽查9个相关源码模块，并核对方向契约、现有DESIGN及sidecar、craft floor、空检测结果和结构化验证记录。结论为`disposition: ship`，material fixes为空，完整记录为`.impeccable/review/model-catalog-finish.md`。

审查范围包括1440/800下设置、星标组、独立选择/收藏、长标签、错误反馈和两种界面既有样式，没有新增的遮挡、裁切或设计系统偏离。终审没有重新运行GUI、测试或检测器，不增加测试次数。额外Agent脚本中曾被首次手册遮挡的4张图明确排除在这10张终审证据之外；不是以无效截图换取通过。既有DESIGN.md及`.impeccable/design.json`保留，本轮未新建或替换视觉系统。

### Agent 选择专项回归

共享ModelPicker接入后的最终`scripts/agent-selection-smoke.mjs`退出0，10/10组通过、8次真实本地模型请求、5次应用重载及4张截图。独立证据为`.impeccable/review/agent-selection-result.json`：`normalExit:true`、`temporaryRemoved:true`、`failure:null`。这些组数不并入模型目录的10组，也不把同一断言的失败尝试或重跑累加为覆盖。

覆盖全部默认及自定义Agent角色、新建和既有会话中的选择与持久化、子Agent显式模型选择及继承主会话、primary/Plan不可覆盖模型、禁用项排除和只读边界。脚本通过真实界面选择子Agent模型及清除覆盖，不能以API设置代替共享选择器验收。

最终4张截图由入口审计者逐张打开，主流程另查看英文日间的子Agent模型编辑和新建会话两图；目标界面可读、主题正确，无首次手册遮挡。这是独立的Agent回归证据，不扩大上文终审对10张模型目录截图的审查范围。

两次先前尝试保留在`.impeccable/review/model-catalog/`：`agent-selection-first-reload-failed.json`记录重载后读取了旧文档的等待竞争；`agent-selection-occluded-first-pass/`保留随后功能断言通过、但4张截图被首次手册遮挡的结果、截图和`visual-coverage.json`。最终脚本使用页面代际标记等待新文档，等待“开始使用”可点击并确认手册关闭，通过真实主题按钮保存日间偏好，并在截图前断言手册不存在及主题正确。以上均为夹具适配，没有因此改动产品或放松功能断言。

该回归仅操作自有临时profile、项目、合成Key和本地SSE，测试应用正常退出，临时数据及测试进程已清理。最后生产构建后只更新非内嵌的交接、验证、终审记录及验收脚本，没有后续产品改动，无需为其重复构建或资源预检。

### 失败尝试与交付边界

- `.impeccable/review/model-catalog/attempt-1-keyboard-focus/result.json`保留真实产品失败：保存期间原生disabled使连续键盘排序丢焦。已改为保存期`aria-disabled`和事件守卫，最终无需手工重新聚焦的连续上下排序通过。
- `attempt-2-provider-load/result.json`保留重启后设置异步供应商列表未加载就开始读取的夹具失败，已修正等待条件，再完整重跑通过。两个目录各保留失败截图，根目录历史`failure.png`不属于最终10张截图，不将首轮描述为全绿。
- 本轮遵循既有DESIGN.md及`.impeccable/design.json`的布局、颜色、字体、Lucide图标和主题语义，没有新增发布位图或替换视觉系统。README、中英文手册/日志及交接同步；最后生产构建后仅更新上述非内嵌记录及验收脚本，不为其重复构建。
- 全部GUI使用自有临时profile、项目、合成Key和本地SSE，不访问正常用户DB、Key、记忆或系统剪贴板，无付费模型请求。模型目录与Agent专项的测试进程和临时数据均已清理。物理触摸、任意掉电、多实例竞争、所有Windows/DPI/GPU组合及完整辅助技术矩阵未认证。
- 保持1.3.1，实验out及内嵌手册已重建；正常退出旧实例后运行`.\run-experimental.cmd`。没有正式打包、安装、升级、执行云SQL、Git提交、推送或发布；33项预检通过不等于正式安装器验收。

## 2026-11-11 补充：维护者已打包后的发布 SQL

维护者已自行生成1.3.1安装包，要求读取SHA及大小生成发布SQL。本轮仅核对已有产物，新增`supabase/publish-release-1.3.1.sql`及更新发布说明，不修改产品或重建安装包。原`supabase/publish-release.sql`的1.3.0历史材料保留。

| 核对项 | 实际结果 |
| --- | --- |
| ZIP文件 | `apps/desktop/release-artifacts/MingshenHarness-1.3.1-x64.zip` |
| 版本及格式 | `.zip.json`为1.3.1、`zip` |
| ZIP实际大小 | 293688365字节，与JSON一致 |
| ZIP实际SHA-256 | `d1f65003f805f2c854c2095d097a0f70ff9d67953ab55e06f32854793b6e6dd3`，实际`Get-FileHash`与JSON、`.sha256`一致 |
| ZIP目录 | 根目录唯一条目为`MingshenHarness-1.3.1-x64.exe` |
| 内部EXE长度 | 293702335字节，与旁置EXE长度一致 |
| 发布表与字段 | 沿用0001/0003的`public.mingshen_app_releases`，格式为`zip`，使用ZIP而非EXE哈希/大小 |
| SQL行为 | 仅upsert版本1.3.1，含发布公告、`now()`、活动状态和真实元数据，重复执行更新同版本 |
| 本地静态核对 | VALUES字段与JSON一致，公告550字符，低于表约束1000字符；新SQL及相关发布文档无行末空白，跟踪文件`git diff --check`通过 |

下载直链尚未提供，SQL保留`REPLACE_WITH_PUBLIC_HTTPS_ZIP_URL`，必须在上传相同ZIP后替换为公开HTTPS直链。未上传、执行云端SQL或验证远端托管，没有安装、运行新安装器、提交或推送；本地哈希与ZIP结构核对不代替安装/升级验收。重新打包或更换ZIP必须重新核对并更新SQL元数据。
