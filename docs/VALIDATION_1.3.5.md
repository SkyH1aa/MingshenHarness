# Mingshen Harness 1.3.5 验证记录

初次验证日期：2026-11-21；最近追加：2026-11-22（Asia/Shanghai）。本轮覆盖简约主题、启动展示、桌宠、设置与 Windows 安装界面。此文件记录当前源码的实际检查；历史版本的结果不计入本轮。

## 变更范围

- 根包、桌面包和共享发布常量统一为 1.3.5。
- 简约主题使用独立限定样式，保留光轨主题和现有工作流。
- 启动页、桌宠各使用独立 HTML、Renderer 入口和沙箱 preload，具有单独的 IPC 范围。
- 桌宠默认关闭；开启后支持置顶、透明度、大小、拖动、位置恢复、问候、闲聊、休息和通用任务状态。
- Windows 安装界面的原子标识动效与标准安装流程分别验证。

## 早期阶段源码、构建与资源检查

| 检查 | 实际结果与范围 |
| --- | --- |
| `pnpm typecheck` | 最终 Node/Web TypeScript 检查退出 0 |
| `pnpm lint` | Biome 检查 494 个文件，退出 0，未自动格式化 |
| 桌宠与启动控制器定向 Vitest | 2 个文件、19 项通过；含偏好写盘失败后的重试、显示桌宠写盘失败不改变内存、任务状态同步、隐藏/重显与启动阶段/跳过/8 秒上限 |
| `node --test scripts/*.test.cjs scripts/*.test.mjs` | 119 项通过，0 失败，78.66 秒；包含安装与桌面资源专项 |
| 安装资源专项 | `scripts/installer-visuals.test.cjs` 4/4 通过：头图/侧图、8 帧资源、原子图标与 NSIS 配置、无安装动作的 UI-only NSIS 编译夹具 |
| `pnpm build` | 最终构建退出 0；TencentDB 25 份固定源一致；main 163 模块、2,057.42 kB；renderer 2,319 模块；生成 3 个独立 preload 和 3 个 HTML 入口 |
| `node scripts/package-desktop-surfaces.cjs` | 最终构建的 3 个 preload、3 个 HTML 和桌宠 PNG SHA 校验通过 |
| Windows 资源预检 | 13,865 项资源、生产依赖和 1.3.5 版本通过；该检查不生成正式 NSIS/ZIP |

该阶段工作台入口为 `index-C0yzxWSu.js` / `index-CJ5P6Gmd.css`，桌宠入口为 `companion-BehJkHVi.js` / `companion-DMtGPnmz.css`，底图为 `atom-companion-Cfjofzey.png`。这些名称用于核对该阶段构建，不能替代后续重新打包的实际产物。

## 早期及中间完整回归记录

本轮较早的一次完整串行 Vitest 退出 0：**183 文件通过、3 文件跳过；2,396 项通过、14 项环境跳过，359.90 秒**。本地日志位于 `.impeccable/review/v135-full-vitest-final/vitest.log`。此后控制器测试有增加，不能用该结果宣称最终源码完整回归全绿。

中间阶段的一次完整串行命令为：

```powershell
pnpm --filter @mingshen/desktop exec vitest run --maxWorkers=1 --no-file-parallelism
```

该次退出 1：**176 文件通过、7 文件失败、3 文件跳过；2,389 项通过、9 项失败、14 项跳过，627.24 秒**。将 7 个失败文件单独串行复跑后，仍为 **121 项通过、9 项失败，312.45 秒**；JSON 位于 `.impeccable/review/v135-targeted-recheck.json`。失败均为超时，部分伴随夹具 `EBUSY` / 清理 Hook 超时。它是后续修复前的中间结果，不代表最终源码回归状态：

- `agents/lsp-diagnostics-service.test.ts`：junction / hard-link 边界场景。
- `agents/tencent-memory-service.test.ts`：linked snapshot 场景。
- `chat/local-plugin-tool.test.ts`：批准后祖先 junction 替换场景。
- `terminal/terminal-service.test.ts`：linked workspace 和真实 PowerShell 进程树停止，共 2 项。
- `workspace/guarded-workspace-io.test.ts`：hard-link / reparse traversal 与静态 junction / pinned ancestor，共 2 项。
- `workspace/local-review-service.test.ts`：junction 下的 recorded diff 场景。
- `workspace/workspace-search-service.test.ts`：跳过 junction 的文件搜索场景。

这些结果没有给出生产 API 的断言失败，但仍是未通过的检查，不能静默改为跳过、通过或笼统归因于机器负载。本轮未为通过测试放宽安全断言、延长测试超时或修改上述产品模块。此前误用默认并行 `pnpm test` 也产生大量超时，已停止该次专属进程；这次中止运行不计为验收结果。

收尾补查：同一 `D:\NodeJs\node.exe` / Node 24.19.0 下，最小 Vitest junction 探针 1 项通过，创建、识别和清理约 16ms，外层 30 秒期限未触发。将现有文件搜索 junction、guarded static junction、guarded hard-link/reparse 三个用例逐项单独运行，均退出 0；真实 PowerShell 进程树停止用例单独运行也退出 0（1 项通过，整次约 4.47 秒）。但终端整文件复跑仍退出 1，24 项通过、2 项超时，并伴随夹具 `EBUSY`；这说明单项可运行，不能据此排除组合运行或资源清理问题。具体根因当时未确定；以上补查不替代该中间完整回归的 9 项失败记录。补查进程均已结束，没有残留对应测试或 `Start-Sleep -Seconds 20` PowerShell；临时最小探针已清理，未改产品或真实测试。

该阶段收尾再次执行 `pnpm typecheck` 和 `package-win.cmd --check`，均退出 0，资源预检为 13,865 项、生产依赖及版本 1.3.5 通过。

## 早期真实桌面专项

`node scripts/desktop-experience-smoke.mjs` 在隔离 profile 下的一次早期运行退出 0：**7 组通过、17 张截图，0 Renderer 异常、0 console error**。本地结果位于 `.impeccable/review/v135-desktop-experience-1795242289119/result.json`，17 张截图均已逐张复核。该结果早于36段视频、原生菜单和启动可见性补强，不代表这些后续功能的最终桌面检查。

- 简约日夜 1,440×900、简约夜间 800×600、光轨夜间 1,440×900：检查主要区域完整矩形、结构重叠、横向溢出和顶栏命中。主窗口场景使用空会话，不是所有历史消息、输入区与面板组合的完整验收。
- 启动展示关闭后可继续进入主窗口；通过真实设置 IPC 关闭动画，重启后没有启动页且偏好保留。实际“跳过”点击和启动动效帧差未在此专项覆盖，控制器的跳过/阶段/超时逻辑由定向测试覆盖。
- 桌宠受限 preload 不暴露 `window.mingshen` 或 `require`；角色 PNG 成功加载，并与 SVG 面部层对齐。
- 桌宠 96 / 176 / 320px 三档：Renderer 保持正方形，可见 DOM 盒未越界；Windows 缩放的原生尺寸取整允许 ±1px 并记录 scaleFactor。正常动画两帧有 56,265 个 RGBA 值变化；系统减少动态效果下两帧完全相同。
- 截图解码确认透明像素和非空角色；Enter 走真实轻拍/问候路径，Pointer 事件经 React、IPC 移动原生窗口。设置可保存大小、透明度、问候、任务提示和位置重置；原生窗口已断言 opacity 0.7 及取消置顶。未另外验证恢复置顶、精确拖动位移、边缘拖动或多显示器切换。

中间失败保留在同目录前缀的旧证据中：轨道曾在底部越界，已修正 CSS 并重建；另一次把 `opacity: 0` 的隐藏状态条位移当作可见裁切，脚本现记录 display / visibility / opacity，并只排除计算后不可见的元素，仍严格检查可见元素。96px 的状态与操作区贴近边缘、信息密度较高；截图不能证明完整辅助技术可用性或真实桌面合成效果。

## 安装界面边界

8 帧原子动画资源 SHA 各不相同，NSIS UI-only 夹具编译通过；欢迎页离开和取消均有计时器/bitmap 清理路径。Windows 拒绝启动此测试 EXE，因此没有获得真实欢迎页轮播或取消操作的运行证据。该次专属夹具目录已清理，未进一步提权或尝试正式安装。正式安装、升级、卸载与高 DPI 安装器仍未验收。

## 交付边界

本轮使用隔离配置和本地合成数据验证，保留用户的正常配置、会话、密钥和数据目录。没有调用真实收费模型，没有生成或安装正式 NSIS/ZIP，没有执行发布 SQL、推送或发布。桌宠/启动页文案仍固定中文；闲聊是内置本地短句。完整 Windows / GPU / DPI / 多显示器 / 辅助技术矩阵、真实收费模型、Office COM 和正常用户 profile 不在本轮证明范围内。

本轮曾发生一次未经用户要求的本地提交：`e6f58016 fix: make companion preference saves retryable`，包含桌宠控制器及测试两个文件；未推送，后续修改仍留在工作区。已保留该提交，没有 reset、revert 或继续提交，避免破坏现有工作。不能声称本轮完全没有本地提交。

试用使用仓库根目录的 `run-experimental.cmd`；正式打包仍由维护者执行 `package-win.cmd`。打包后需重新读取 1.3.5 ZIP 的 SHA-256、大小和内部 EXE 版本，不复用旧版本元数据。

## 36 段视频动作、菜单与全屏启动的追加验证

本节记录同一版本后续实现，前述阶段结果及失败仍保留。用户原始视频只读保留；动画处理、动作播放器、原生菜单、桌面设置导航和全屏启动展示属于本轮新增范围。

完整串行命令：

```powershell
pnpm --filter @mingshen/desktop exec vitest run --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile.json=../../.impeccable/review/v135-companion-full-vitest.json
```

退出0：**186文件通过、3文件跳过，2438项通过、14项环境跳过，0失败，336.57秒**。报告为`.impeccable/review/v135-companion-full-vitest.json`。新增范围包含桌宠控制器22项、菜单9项、动作调度11项及启动控制器/preload17项。此前超时的7个文件本次均通过；本轮未放宽其安全断言或延长测试超时，不能据单次通过推定此前超时的根因已消除。

Node/Web TypeScript再次通过；Biome检查500文件通过。设置错误复核后将保存错误独立于显示/隐藏错误，保留待重试补丁、独立重试入口及离开页面保护；桌宠字体与现有字体栈统一。最终静态界面检测覆盖播放器、桌宠、启动页及桌面设置6个文件，退出0，0主问题、40个advisory，主要是独立桌面表面的颜色及小尺寸状态字级；不是完整可访问性验收。检测输出为`.impeccable/review/v135-companion-impeccable-final.json`。

素材原片存在红粉渐变、接地阴影、暖色皮肤与背景接近，以及第21段坐姿尺度大于相邻片段等问题。早期样片误抠手部和保留背景碎块，均只作为开发中间结果，不能用于证明最终去色质量。实际素材及真实桌面结果以下列后续记录为准；静态WebM签名、`alpha_mode`标签和打包哈希分别只能证明对应的文件属性，不能替代浏览器解码、透明像素与可见效果检查。

### 最终素材及生产构建

用户的`36个桌宠动画/1.mp4`至`36.mp4`保留，最终资源写入`apps/desktop/src/renderer/companion-assets/motions/`。批处理退出0，用时208.5秒，36段合计**31,863,747字节、4,404帧、720×720、24fps**。第20/22段各145帧、约6.042秒，其余各121帧、约5.042秒。清单`manifest.json`逐条保存原片与输出SHA-256、大小、帧数、时长、循环属性和Alpha采样，并记录处理脚本/算法SHA、编码参数及第21段的固定配准；清单SHA-256为`98924497d6317c325fed0afb67fcb636d674333994a47669d80a3d49843d5f37`。

处理入口为`scripts/prepare-companion-motions.cjs`，去色算法为`scripts/companion-video-key.cjs`。本次仅开发期显式调用外部FFmpeg/FFprobe 8.1.2，不复制或捆绑该运行时。原帧先做边界连通去色，再进行透明缩放/填充；第21段角色缩至512×512并放到720×720画布x101/y208。编码管线采用有界流和背压处理，先暂存、成功后发布输出；相关脚本定向测试10/10通过，随后包含于下表根脚本完整回归。

实际WebM解码所得浅/深背景接触表为`.impeccable/review/companion-processed-135/contact-1.png`至`contact-3.png`，每段查看首/中/末帧，三张均已逐张查看。仍有部分皮肤与手指边缘的抠像损失及轻微红边，尤其第9段；源片生成的身份、服饰、手部和姿态变化保留，封闭区域的红色细节也可能保留。第33段采样在左下有小粉色碎片，实际桌面尺寸效果继续由真实专项核对。不能据此宣称无损抠像、逐像素完美或片段无缝衔接。

第21段曾因透明PNG预览显示近透明RGB被误报红底；RGBA复核背景采样alpha=1、人物内部alpha=255，浅/深合成未见不透明红底，未因此重做资源或更改源片。`alpha>0`的统计含alpha=1，不能作为可见人物面积的证明。

| 素材就位后的检查 | 结果 |
| --- | --- |
| `node --test scripts/*.test.cjs scripts/*.test.mjs` | **137项通过，0失败、取消或跳过，25.99秒**；包括全部动作清单/入口可达性、去色与流水线、浏览器视频采样助手、安装器资源及既有原生依赖打包检查 |
| `pnpm lint` | Biome **500文件**，退出0，无自动修改 |
| `pnpm build` | 退出0；TencentDB25份固定源一致；main164模块、2,072.86kB；renderer2358模块；3组preload及HTML，36段WebM全部输出 |
| `node scripts/package-desktop-surfaces.cjs` | 3个preload、3个HTML、原角色PNG、36段动作（31,863,747字节）的SHA与入口依赖图检查通过 |
| `package-win.cmd --check` | 退出0，**13,865项资源、生产依赖及1.3.5版本**通过；未创建正式NSIS/ZIP |

本次生产入口为`index-DZcYCaeS.js`/`index-CJ5P6Gmd.css`，桌宠为`companion-nF_tdeLQ.js`/`companion-BQvzCU6b.css`，启动为`startup-DiQLLh_R.js`/`startup-s2DYVeUi.css`。主应用JS为4,122.89kB，另有共享运行时和图标块；不能仅以单个主入口大小计总包大小。该构建与静态资源检查不替代下述真实Electron、系统合成和安装升级验证。

### 约5秒启动与SQLite预读阶段

正常展示调整为可见等待4,680ms加320ms退场控制，合计约5秒；保留主窗先就绪时500ms本地加载宽限、从控制器启动起8秒保护、跳过及失败放行。主窗口在展示下面准备首屏；该阶段的首次协议读取等待展示结束及主窗口调用`show()`后放行。后续真实桌面测试发现调用完成不保证原生窗口已可见，最终修复及可见性条件见“最终回归与桌面专项”。关闭、重载、退出和迟到的文件读取均复核当前窗口及页面代际，防止旧请求启动阅读计时；主进程和界面仍各自检查至少5秒。退出因草稿保存失败而取消时，会恢复仍未完成的主窗口显示流程。

展示显示后通过`setImmediate`安排可选索引预读，只在已同意协议、展示仍活跃且应用未退出时使用现有SQLite连接。两条固定查询各`LIMIT 32`且只取常量，分别使用未归档顶层会话目录与Chat目录覆盖索引；不扫描全部消息、读取正文或密钥，也不生成应用快照。`busy_timeout`临时为0并在`finally`恢复，失败不阻止启动。数据库打开和迁移仍在展示之前，同步磁盘I/O无法被定时器抢占；此处不保证精确启动耗时或可量化性能提升。

该阶段定向5文件33项通过，包括真实临时SQLite/WAL、覆盖索引与32行上限、配置恢复及失败调度，以及展示遮挡8秒不抵扣协议阅读、揭示后4,999ms拒绝/5,000ms允许、文件读取期间页面失效等场景。独立只读审查也分别用内存数据库与临时WAL双连接核对查询计划、配置恢复和提交后快照可见性，没有读取用户数据库。

桌宠收尾修正了小尺寸静图回退的动作位移及内缩焦点环、状态条和操作按钮过渡方向；无任务消息的隐藏状态按钮在键盘聚焦后恢复可见。中间一次全量Biome发现新增索引预读测试文件的导入顺序及格式两项问题，已修正，随后504文件检查退出0。以下回归与构建使用上述修正后的源码，但发生于后续`greeting`到`idle`切换误清排队跳舞的动作调度修复之前，不能作为该修复后的最终结果。

该阶段完整串行Vitest使用前述相同参数，报告改为`.impeccable/review/v135-five-second-full-vitest.json`，日志为同名`.log`。退出0：**188文件通过、3文件跳过；2,450项通过、14项环境跳过，0失败，298.06秒**。此前7个超时文件本轮均通过，历史失败仍保留，不据此宣称根因已经消除。

| 该阶段检查 | 实际结果 |
| --- | --- |
| `node --test scripts/*.test.cjs scripts/*.test.mjs` | **137项通过，0失败、取消或跳过，26.21秒** |
| `pnpm typecheck` | 该阶段源码下Node/Web均退出0 |
| `pnpm lint` | 该阶段源码下Biome **504文件**，退出0 |
| `pnpm build` | 退出0；TencentDB25份源一致；main166模块、2,076.96kB；renderer2358模块；3组preload及HTML |
| `node scripts/package-desktop-surfaces.cjs` | 3个preload、3个HTML、原角色PNG、36动作共31,863,747字节的SHA及真实入口引用检查通过 |
| `package-win.cmd --check` | 退出0，**13,865项资源、生产依赖、版本1.3.5**通过；不生成正式安装器 |

该阶段构建主入口仍为`index-DZcYCaeS.js`/`index-CJ5P6Gmd.css`，桌宠更新为`companion-DoXaEIX9.js`/`companion-DidBt-B1.css`，启动为`startup-DiQLLh_R.js`/`startup-s2DYVeUi.css`。独立preload为37.70/0.91/1.40kB（主窗/启动/桌宠）；文档与验证表不替代真实窗口或安装升级验收。

### 动作队列修复后的最终源码回归

真实桌面检查中发现，问候的临时状态从`greeting`恢复为`idle`时，会清除尚未播放的手动互动。`CompanionMotionScheduler`现保留普通状态变化前排队的互动，拖动、休息、成功、失败及明确取消仍按各自规则中断。普通任务状态变化时，真实状态徽标立即更新，但角色的工作动画可能延后一个互动片段；不把角色正在播放的动作当作任务执行状态。新增回归覆盖问候结束、普通任务状态变化及紧急中断，动作调度文件共14项通过。

动作调度修复后的阶段完整串行Vitest：**188文件通过、3文件跳过；2,453项通过、14项环境跳过，0失败，311.09秒**。报告为`.impeccable/review/v135-five-second-final-vitest.json`，日志为同名`.log`。该报告早于后续启动可见性修复，作为阶段结果保留，不作为最终全量回归。根脚本整套该阶段**137项通过，0失败、取消或跳过，23.20秒**，日志为`.impeccable/review/v135-five-second-final-scripts.log`。此前失败与跳过记录均保留；单次后续通过也不能解释先前超时的根因。

修复后生产桌宠入口为`companion-Gbar3-oy.js`/`companion-DidBt-B1.css`，主工作台和启动入口不变。Node/Web类型检查、Biome504文件、生产构建、桌面资源检查及13,865项资源/生产依赖/1.3.5版本预检均已通过。该阶段中途桌测失败不计为完整通过；最终桌面运行及其边界见下文。以上源码回归和资源检查也不替代正式NSIS安装、升级或卸载验收。

## 最终回归与桌面专项

启动可见性修复后重新执行完整串行 Vitest：**188 个文件通过、3 个文件跳过；2,460 项通过、14 项环境跳过、0 失败，318.75 秒**。报告与日志分别为`.impeccable/review/v135-startup-complete-final-vitest.json`和`.impeccable/review/v135-startup-complete-final-vitest.log`。之前的2,453项与2,450项是启动修复前阶段结果；2,389项通过、9项超时失败的中间运行及其补查也继续保留为历史记录。最新根脚本为**137 项通过、0失败/取消/跳过，30.25秒**；Node/Web类型检查、Biome 504文件、生产构建、桌面入口资源检查及`package-win.cmd --check`均通过。资源预检为13,865项，版本1.3.5；未运行正式NSIS安装、升级或卸载。

更新后的`node scripts/desktop-experience-smoke.mjs`在隔离profile下退出0：**22组通过、88张截图、68组几何记录、36/36段动作解码、0异常、0 console error**。结果位于`.impeccable/review/v135-desktop-experience-1795273556791/result.json`。覆盖包括简约主题日夜与紧凑窗口、光轨设置流程、启动展示跳过/禁用/重启、全36段WebM在Electron Renderer多时点解码、真实右键菜单入口与动作回调、ChatAgent快捷会话、任务状态和输入草稿保护、中英文、暂停和减少动态效果、拖动锁定/指针取消、96/176/320px操作区边界、静图故障回退、桌面偏好持久化、首次协议阅读门槛、11秒延迟窗口和500ms宽限下启动层级。实际启动展示在已接受配置下可见5025ms。完整场景不是正式安装器、DPI/GPU/多显示器、辅助技术或所有Windows环境验收。

这轮发现并修复一个首次协议读取门槛问题：`BrowserWindow.show()`调用完成不必然表示原生窗口已经可见，启动层结束时立即放行会过早开始五秒阅读时间。跳过启动展示发生在主窗口ready之前的真实回归中，`show()`返回时窗口仍为`visible=false`；现在主窗口先`showInactive()`再`show()`，并以`isVisible() && !isMinimized()`确认原生可见，确认后才放行协议读取。后台`showInactive()`本身不代表可见。`StartupVisibilityConfirmation`默认最多轮询80次、每次25ms，等待有界；同一代际的并行显示请求合并，取消/重载会使旧代际失效，新代际可以重新请求。窗口关闭、Renderer重载/失效、退出取消和异步读取后的身份复核均保留。主进程与界面仍分别执行至少五秒门槛。

桌面 smoke 的第一轮清理还遇到夹具关闭后迟到的本地 SSE 请求；已调整夹具收尾等待请求结算，不改产品断言。最终结果无异常，专项和测试进程及临时profile均已按目标范围清理。该结果不证明历史超时根因已经消除，也不替代正式安装包、GPU/DPI、屏幕阅读器或完整Windows兼容矩阵验收。

## 2026-11-22 桌宠与 Chat 管理追加检查

本节是同版本后续修改的独立证据，前述结果不作为本轮最终源码或重处理媒体的验收。新增范围为工作会话面板、标题显示控制和脱敏、受限导航回执、小屏窗口几何、待机趣味动作及免打扰、视频故障恢复、ChatAgent跨分组批量归档/恢复/删除，以及36段动作的残红清理。原始视频、用户正常profile与数据保留。

### 源码回归与已知失败

首次完整串行Vitest退出0：**190文件通过、3文件跳过；2506项通过、14项环境跳过、0失败，521.85秒**。报告位于`C:/Users/ASUS/Desktop/.impeccable/review/v135-companion-followup-final-vitest.json`；该路径在仓库外，因为当次输出参数解析到其父目录，不应假称位于仓库内。该结果早于显式启用桌宠时创建/显示失败后重试的最后补丁。

显式`enabled:true`重试补丁新增创建失败、显示失败及修改其他设置不重显暂时隐藏窗口三项测试；控制器40/40、Node类型和相关Biome均通过。最终源码再次完整串行运行：

```powershell
pnpm --filter @mingshen/desktop exec vitest run --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile.json=../../.impeccable/review/v135-companion-followup-complete-vitest.json
```

退出1：**189文件通过、1文件失败、3文件跳过；2508项通过、1项失败、14项环境跳过，348.57秒**。报告在仓库`.impeccable/review/v135-companion-followup-complete-vitest.json`。失败为`guarded-workspace-io.test.ts`的`clears an idle stop while a later request is active and can restart after idle exit`，936ms收到“受保护文件守护进程已退出。”，栈指向`guarded-workspace-io.ts:1719`的子进程exit处理。不是20秒测试超时，不以机器负载或前次通过推定原因。

保持原测试及产品代码，随后串行单独复跑用例1/1通过，整文件13/13通过（22.83秒），该用例再以`--repeats=9`重复10次均通过（22.82秒）。请求队列、发送前清闲置计时及stopping进程重建的静态审查没有确认确定性竞态，但退出日志缺少请求阶段、code/signal及停止来源，**根因仍未确定**。本轮没有通过放宽安全断言、增大超时、加入自动重试或改为跳过来掩盖失败；上述复跑不能把这次全量记为通过。

已完成的脚本阶段回归为141项通过、0失败/取消/跳过（45.83秒）；Node/Web类型检查与Biome509文件通过。该脚本结果发生在第33段最后地面残影清理之前，最终媒体处理后的脚本、构建、资源和真实桌面结果在下文另记。

### 会话切换与草稿保护后的源码回归

后续补齐桌宠导航的同步预检、最终领取和过期回执检查，有效的并发跳转以最后一次选择为准。未保存的历史消息、项目记忆、跨工作目录文件编辑、生图操作和未交接的创作草稿受到离开保护。主界面批量操作与快捷 Chat 的新建、隐藏、归档和删除，复用草稿 revision 校验和保存失败处理；快捷窗口先锁定输入，等待在途发送、引导、历史重写、草稿恢复及保存结束，再提交会话快照或归档状态后解锁。失败不会静默丢弃原会话或编辑内容。

上述源码冻结后，完整串行 Vitest 退出0：**196文件通过、3文件跳过；2,621项通过、14项环境跳过、0失败，345.05秒**。最终 JSON 位于仓库`.impeccable/review/v135-companion-followup-final-vitest.json`，SHA-256 为`29fd1443a06a476755b97c763d28e5a3eb93055e3a93760c07c8fac26e186900`。该 JSON 是新一轮直接输出；同目录同名旧`.log`记录的190文件/2506项属于前述首次阶段，不能当作这份最终报告的日志。JSON 中 Vitest 的聚合 suite 数包含嵌套描述，文件数按199条文件结果及其中3个全跳过文件计算。

3个整文件环境跳过为文档隔离、原生持续命令真实运行和Docker真实运行；另有同类环境条件下的用例跳过，合计14项。前述守护进程退出的全量失败及后续单独复跑仍保留，不据最终单次通过推断历史失败根因已解决。

接续时再次执行`pnpm typecheck`与`pnpm lint`，Node/Web类型检查及Biome **519文件**通过。最终界面机械检查覆盖桌宠播放器、任务面板、设置、Chat侧栏、主聊天区、快捷Chat及其样式共9个目标，**0项主问题、49项advisory**，为37项色值、3项圆角及9项字号提示；输出为`.impeccable/review/v135-companion-followup-verified-impeccable.json`。它不替代真实窗口、键盘、辅助技术或完整屏幕尺寸验收。

第33段提示动作只按匹配的原片SHA执行鞋边清理，并保留原始36个MP4。最终WebM为`797,420`字节，SHA-256=`5457bed21ae4a675cd819e5b9772cf4ef5968f14c21666a3cbe86fee3c30bbba`；36段合计`32,760,385`字节、4,404帧，manifest SHA-256=`11bf5abcb116e07a9920288e644469f72546e476d42bb1960ecfd7a0638bf557`。其他35段的WebM SHA和36段源SHA保持不变。

第33段121帧像素证明位于`.impeccable/review/companion-33-debris-fix-135/final/raw-proof.json`：它比较的是原MP4解码RGBA经通用去色后、source-specific鞋边清理前后的缓冲区，发生在VP9有损编码之前；所有RGB、`y<620`区域RGBA及全部超过256像素的8连通人物主体RGBA共10,964,620像素均保持。它**不**证明有损WebM逐像素不变。编码后的320px浅/深背景预览和足部放大图位于同目录`before-after-320.png`、`foot-after-white.png`、`foot-after-dark.png`；真实背景碎点已经去除，但VP9在鞋边可留下极低透明度色晕，320px预览不见可辨红点，放大后仍可见轻微边缘残色或抠像锯齿，不承诺彻底无红或无损。素材清理逻辑30项定向测试通过；完整资源脚本回归及最终Electron/构建证据仍以本节后续追加项为准。

### 最终素材构建与资源预检

在第33段及正式素材脚本冻结后执行以下检查：

| 检查 | 实际结果 |
| --- | --- |
| `node --test scripts/*.test.cjs scripts/*.test.mjs` | **157项通过，0失败、取消或跳过，29.75秒**；日志为`.impeccable/review/v135-companion-followup-verified-scripts.log` |
| `pnpm build` | 退出0；TencentDB25份固定源一致；main169模块、2,105.02kB；renderer2362模块，3组preload/HTML及36段最终WebM均输出；日志为`.impeccable/review/v135-companion-followup-verified-build.log` |
| `node scripts/package-desktop-surfaces.cjs` | 3个preload、3个HTML、原角色PNG与36段动作共32,760,385字节的SHA及真实Renderer入口引用检查通过 |
| `package-win.cmd --check` | 退出0，**13,865项资源、生产依赖及1.3.5版本**通过；未生成正式安装器 |
| `git diff --check` | 退出0，无空白错误；Windows行尾转换提示不作为产品故障 |

最终主入口为`index-Ca2GyCVz.js`/`index-Bg4OjqQj.css`，桌宠为`companion-DAKnv3x9.js`/`companion-Dddzz5AG.css`，启动为`startup-DiQLLh_R.js`/`startup-s2DYVeUi.css`，第33段为`notify-CYeGHMQe.webm`。独立preload为39.74/0.91/1.72kB（主窗/启动/桌宠）。这些结果证明当前构建与资源闭包，不能代替下述真实Electron检查或正式NSIS安装、升级、卸载验收。

### 工作会话与 Chat 批量管理的真实桌面验收

在上述应用源码及构建冻结后，`node scripts/desktop-experience-smoke.mjs` 的完整隔离 profile 专项退出0：**32组通过、118张截图、75组几何记录，0 Renderer异常、0 console error**。结果为`.impeccable/review/v135-desktop-experience-1795338412733/result.json`，日志为`.impeccable/review/v135-followup-desktop-smoke-complete-final-retry.log`。该次脚本SHA-256为`22b6c32259f09be8327197148995cca14020ceb425cdbc2c327666385d2c9e3d`。36条视频均`ok:true`，各3个时点共108次采样；该次视频仍为透明RGB扩散处理前的媒体，不能用于证明后续重新编码资源。

- 真实本地SSE任务出现在桌宠面板及原生菜单，状态和耗时更新；96/176/320px、折叠/展开、中英文、任务结束后拒绝旧入口均通过。模拟240×280px工作区时，原生窗口、IPC布局和面板同步约束为168px角色及112px面板，不改用户保存的320px偏好。
- 标题开关的待保存、首次保存失败和重试与隔离SQLite值一致；关闭成功后桌宠IPC标题为空，面板、菜单和可见文本不包含标题。任务正文、回复、路径和审批详情未传入桌宠。
- 桌宠跳转遇到未保存计划、真实历史消息编辑或项目记忆编辑时收到拒绝回执，原编辑内容保留；延迟领取时任务行保持忙碌，主进程接受后才完成跳转。真实任务及免打扰能中断待机动作，迟到的`play()`结果不恢复旧视频；一次播放失败可通过后续互动或动画重开恢复。
- Chat跨分组、折叠分组、置顶与归档列表覆盖了取消、搜索全选、混合状态限制、归档/恢复、注入部分失败后重试、运行中拒绝归档、删除前停止和重载持久化。活动/归档目录第二页加载失败不会提交部分列表，重试后每项只出现一次。
- 快捷Chat及主窗口批量归档等待草稿保存，锁定冲突输入；保存失败、真实revision冲突、确认解决后重试和删除后的迟到保存均通过。这里只证明源草稿保存结束前保留原会话并锁定输入，不单独证明被拦截的切换ACK时序。
- 原生右键回调、手动互动、拖动锁定、减少动态效果、静图回退、七种合成状态的三档尺寸几何及每种六个动画时间点均通过；启动展示、协议阅读门槛、SQLite预读和延迟窗口场景也完整执行。已接受配置下正常启动展示可见约5,027ms。

中间失败没有改写为通过：首轮未提交休息分钟草稿检查缺少焦点事件记录，不能确认其根因；后续将检查放在抢焦操作前，严格证明无`blur`时文本为73而持久化仍0，再用可信Tab触发离焦并确认保存73。小工作区夹具因Electron对`screen`方法的代理包装而不能用函数引用恒等判断安装，现改为验证实际调用及返回的工作区，产品布局断言保留。历史编辑按钮选择器从错误的“编辑消息”改为真实“修改消息”，后续真实编辑及脏状态断言保留。

另一次完整运行在合成静图的有限时长动画采样中失败（`.impeccable/review/v135-desktop-experience-1795337173135/failure.json`）；独立窄复测通过，未能据此确定原失败根因。采样现将查找与暂停原动画对象放在同一次Renderer调用，保留预期状态、原动画对象、像素及几何断言，没有修改产品动画。之后还有一次`Page.captureScreenshot`超时（`1795337937058/failure.json`）；独立最小化窗口探针仍可截图，不能认定最小化是根因。纯截图调用最多允许一次有记录的重试，不重试业务断言；最终完整运行实际重试0次，仍保留该历史失败。

专项退出后，本次smoke Node、调试Electron进程和`mingshen-desktop-experience-*`临时profile均为0。原生菜单回调由夹具调用，不等于真实系统菜单点击或屏幕阅读器验收；静图解码故障与状态注入是合成场景。完整Windows、DPI/GPU、多显示器、真实收费模型、正常用户profile及正式NSIS安装/升级/卸载仍未在本轮验收。

### 透明边缘颜色修复与最终媒体验收

在上述完整产品专项之后，再对全部36段媒体增加6px透明边缘颜色扩散。VP9的4:2:0色度采样仍可能将完全透明区域的红色混入可见轮廓；该步骤将邻近前景颜色延展到完全透明像素，只修改这些像素的RGB。去底、闭合区域清理及第33段按源SHA限定的碎点清理继续保留，不覆盖用户原片。

全部4,404帧在扩散前后逐帧比较，Alpha均不变，385,716,795个非零Alpha像素的RGBA均不变；证明仅覆盖**去色后、透明RGB扩散前后、缩放与VP9编码之前**的处理阶段。它不代表原始视频到最终WebM无损，也不延伸到第21段随后的缩放或有损编码。证明汇总为`.impeccable/review/companion-edge-alpha-audit-135/final-36-report.json`。第12段小样三时点的轮廓红色优势指标下降约30%至38%，但整体合成MSE略升，不能说所有像素或全部画质指标都改善；小样数据为同目录`12-trial-report.json`。

最终36段合计**47,530,948字节、4,404帧**，比扩散前32,760,385字节增加14,770,563字节（约45.1%）；这是透明边缘颜色变复杂带来的媒体体积代价，不是正式安装包的增量测量。全部36个源MP4的SHA保持不变。最终manifest SHA-256为`541f509ccc77128f9ee8edc47c8e926c4533e0ddb61ca9f2782e7ba33c279f13`，生成脚本SHA为`cd5f1ae86d243df3feb994737f115256ee8a3cfc103e85a536d38b0d98e3e9c0`，去色/扩散脚本SHA为`b426f0041eca0dc185e11d53e58f5c4d93926122b408a4f2f261b6943633ae24`。首、中、末帧浅深背景接触表位于同目录`final-36/contact-1.png`至`contact-3.png`，均已查看；高倍放大仍可能出现细微暖边、源片细节差异或抠像损失，不承诺逐像素无残色。

| 最终媒体后的检查 | 实际结果 |
| --- | --- |
| `node --test scripts/*.test.cjs scripts/*.test.mjs` | **160项通过，0失败、取消或跳过，23.56秒**；日志为`.impeccable/review/v135-companion-followup-bleed-final-scripts.log`。新增覆盖肤色、红饰、alpha=1、扩散边界/半径及无前景等保护。 |
| `pnpm build` | 退出0；TencentDB25份固定源一致；main169模块、2,105.02kB，renderer2362模块；日志为`.impeccable/review/v135-companion-followup-bleed-final-build.log`。 |
| `node scripts/package-desktop-surfaces.cjs` | 3组preload/HTML、原角色PNG、36段47,530,948字节媒体的SHA与实际Renderer入口引用图通过；日志为同前缀`-surfaces.log`。 |
| `package-win.cmd --check` | 退出0，**13,865项资源、生产依赖及1.3.5版本**通过；日志为同前缀`-package-check.log`。 |

主入口仍为`index-Ca2GyCVz.js`/`index-Bg4OjqQj.css`，桌宠入口改为`companion-DR-7HiLX.js`/`companion-Dddzz5AG.css`；启动入口保持`startup-DiQLLh_R.js`/`startup-s2DYVeUi.css`。本次只改变媒体生成管线、媒体资源与专项脚本，没有随后改动应用逻辑；前述2,621项源码回归和完整32组产品专项作为对应应用逻辑的证据保留，最终媒体另行验证。

在这次新构建上执行`node scripts/desktop-experience-smoke.mjs --media-only`退出0：**2组、38张截图、2组几何记录，36/36段视频、108次采样通过，0 Renderer异常、0 console error、0截图重试**。沿用完整专项的逐段解码断言，各段三个时点均有透明和可见非黑像素，且每段至少一对采样帧发生变化；180×180采样中透明像素最少25,377，可见及非黑像素最少4,107。这证明真实Electron解码和基本像素质量，不证明逐帧全片无红边。结果为`.impeccable/review/v135-desktop-experience-1795339351075/result.json`，SHA-256为`92e8222d0eedbeb1f46ecdaa2f39d961cce8f13b98be84755aff6b027ed12ddc`，日志为`.impeccable/review/v135-followup-final-media-smoke.log`；当前脚本SHA为`807090ad2bf80931d8e532e40450b54abb03e8fdcdf8660584a8b6c0740cf21f`。

最终媒体专项的Node、匹配调试Electron及临时profile均已清理；没有生成正式NSIS/ZIP、安装、发布或推送。双语手册、更新日志、README、发布说明和桌宠调研文档的入口及功能边界另经只读交叉核对，未发现确定性不一致。

## 本地插件逐请求 Hook、网页预算与更新轮询（2026-11-22）

保持应用版本1.3.5。用户导出的1.3.4日志中有12条 `SKILL_RESOURCE_NOT_FOUND`，对应 Harness Plugin API 技能所指向的缺失参考资源；已补齐并在技能文件中公布有效相对路径。市场根目录现可直接选择 `marketplace.json` 校验，逐个报告插件来源与错误，不因此安装或登记市场。日志里 `route-marker/hooks/hooks.json` 另有未闭合字符串/编码异常，错误位于用户插件源文件，本轮没有更改该目录的文件。

网页工具将 `web_search` 和 `web_fetch` 的单次预算提升至90秒；搜索回退共享同一个截止时间。用户取消、预算超时、网络/服务失败有不同错误文本。该预算只限网页工具，不覆盖模型调用和其他工具；DNS错误、断网、远端拒绝或协议不兼容仍可能失败。旧日志中大量“operation was aborted”跨越多个版本与请求类型，不能据此把所有记录都归因到单一20秒网页期限。

`BeforeModelRequest` 现在是主 Code/Work 活跃运行中的逐请求声明式提示Hook，覆盖后续模型轮次、网络重试、该运行触发的压缩与记忆请求。实际经 `runSubagent` 从活动父运行派生的子任务在其每次模型请求前加载父会话已选与派生时已激活插件的 `type:"prompt"` 文本；存活的子任务会读取父运行之后激活的插件，变化只应用于下一条尚未发送的请求。父run后续激活通过独立的子任务prompt-only集合传递，不填充子任务的插件动作/MCP激活集合。直接打开的独立 `@` 子会话没有活动父run映射，不继承。ChatAgent、审批安全模型、AutoDrive、草稿润色和事后标题请求也不在范围；子任务动作Hooks、`UserPromptSubmit`、`Interrupt`、插件命令、MCP及 `local_plugin` 仍禁止。子Hook收集失败或超时会阻止当前模型请求发出。

校验器及运行时共用 `plugin-prompt-declaration.ts`：缺失、非字符串、仅空白/空字符的 `BeforeModelRequest` prompt `text` 在安装校验时报错；已有启用插件在运行中出现无效声明时，当前请求fail-closed。command/MCP动作内部的prompt形状不被当作声明式Hook。原单项4,000字符、聚合12,000字符限制及3秒总加载预算继续保留。

更新检测仍采用round-robin，每轮最多10个登记市场、每市场最多200个目录条目；候选按市场缓存，扫描另一批不会清除尚有效的旧候选。每轮只替换实际扫描市场的结果，并复核当前登记、市场路径、provenance、已安装插件与严格SemVer关系以清除失效候选。按钮改为“轮换检查下一批市场，最多10个”。无来源记录或来源不可追踪的直接导入插件不按名称自动关联；只有用户确认来源并点击更新后才安装，安装前会重新校验。更新不静默执行新版。

### 最终验证

| 检查 | 本轮结果 |
| --- | --- |
| 受影响定向Vitest：插件验证、Hook、SubAgent、市场更新、网页工具、压缩缓存 | **7个文件，161项通过、1项平台条件跳过** |
| ChatService/模型流/压缩缓存回归 | **4个文件，214项通过** |
| `pnpm test` 完整Vitest | **退出1：191文件通过、6文件失败、3文件跳过；2,664项通过、7项失败、16项跳过**；7项均在创建Windows junction/symlink夹具时 `EPERM`，覆盖LSP、`local_plugin`、Terminal、guarded workspace IO（2项）、LocalReview与WorkspaceSearch。安全断言没有被放宽；这不是全量通过。 |
| `pnpm typecheck` / `pnpm lint` | 退出0；Node/Web类型检查通过，Biome **522文件**通过 |
| 根Node脚本套件 | `node --test scripts/*.test.cjs scripts/*.test.mjs`：**160通过，0失败/取消/跳过** |
| `pnpm build` | 退出0；main **171模块/2,149.03kB**，renderer **2,362模块**，生成3组HTML/preload |
| `node scripts/package-desktop-surfaces.cjs` | 通过：3个preload、3个HTML、36段桌宠动作 |
| `package-win.cmd --check` | 退出0：**13,871项资源**、生产依赖闭包及1.3.5版本；不构建正式安装包 |
| `node scripts/local-plugin-smoke.mjs` | 隔离profile退出0：**27场景、89次模型请求、15张截图**。子任务父请求3次、子请求2次都带逐请求标记；子任务完成只读`read_file`工具循环，子工具列表无fixture插件MCP，前后MCP action日志不变。 |
| `git diff --check` | 退出0；仅有既有Windows CRLF转换提示 |

Electron smoke 结果为`.impeccable/review/v133-local-plugins-1795351462798/result.json`，SHA-256=`e1490d265b8da7ed2a4376d69717b68eb2f85d6f2ae9a6bea21aa05e52b77a0f`；当前脚本SHA-256=`9ff28a56c5fd6831fb3a1555a9424aae8c44599c79ff228087feab45d8691b79`。测试使用临时profile、本地Responses夹具与本地stdio MCP，不访问用户数据库、真实模型API、付费服务或云端。未生成正式NSIS/ZIP，未安装、发布或推送。

### 最终交接复核

交叉核对发现 README 曾保留旧版 `BeforeModelRequest` 说明（750ms后跳过且排除实际子任务），已更正为源码合同：3秒总预算、每条/聚合字符上限；声明加载失败、超时或超限时，在发送前拒绝本次模型请求；由活动父任务通过 `runSubagent` 派生的子任务只继承声明式提示文本，不获得插件动作能力。该次只改文档，不改变构建入口。

最终定向复跑9个Vitest文件（扩展验证、Hook、市场轮询、网页工具、子任务、会话/压缩和模型流）**289项通过、1项平台条件跳过**。`node scripts/package-desktop-surfaces.cjs`通过，覆盖3个preload、3个HTML、桌宠PNG及36段47,530,948字节动作；`package-win.cmd --check`退出0，检查13,871项资源、生产依赖与1.3.5版本；`git diff --check`退出0，显示的仅是既有Windows LF/CRLF转换提示。完整Vitest仍有前述7项Windows junction/symlink夹具 `EPERM`，不得将其改写为通过。未生成正式安装包。

## 生图工作台交付与桌宠置顶看护（2026-11-22）

版本保持1.3.5。生图工作台将质量、自动/预设/自定义分辨率、宽高、16倍数对齐、比例、透明背景和1–10张输出贯穿设置持久化、主进程验证和供应商请求；返回图片须为Base64并经真实图片解码校验，URL-only响应拒绝，确认大小、数量、尺寸和透明背景格式符合约束后才存入素材库。素材卡提供“保存原图”按钮，Renderer/Preload只传素材ID；主进程核对素材后展示系统保存对话框，再以固定数据写入用户选择的位置。不同图片模型或兼容网关能力不一致，应用不自动协商/屏蔽不支持的参数，供应商拒绝时显示错误。

桌宠修复Windows置顶“只调用一次always-on-top、无法处理未映射事件”缺口：使用Electron `screen-saver`窗口层级；窗口失焦时再次设置层级并调整Z序。置顶开启期间以200ms递归单次定时器检查Electron可见/最小化状态；系统隐藏或最小化后等待300ms，再优先使用`showInactive()`恢复。主动隐藏/关闭、禁用、取消置顶、窗口替换及退出清理看护和恢复计时器。它是对Electron报告状态的尽力恢复，不是对Win32 `Win+D` Shell行为的豁免。

| 检查 | 本轮结果 |
| --- | --- |
| 生图、Preload与桌宠定向Vitest | **5个文件，89项通过**：参数Schema、服务请求、多图响应/存储、素材下载路径边界、置顶恢复/用户隐藏/失焦重申及无窗口事件时的轮询恢复 |
| 完整串行Vitest | `pnpm --filter @mingshen/desktop exec vitest run --maxWorkers=1 --no-file-parallelism`：**198文件通过、3文件跳过；2,692项通过、15项跳过、0失败，282.50秒** |
| 根Node脚本套件 | `node --test scripts/*.test.cjs scripts/*.test.mjs`：**160项通过、0失败/取消/跳过** |
| `pnpm typecheck` | 退出0，Node/Web TypeScript均通过 |
| `pnpm lint` | 退出0，Biome检查**523个文件**通过 |
| `pnpm build` | 退出0；main **171模块/2,161.74 kB**，renderer **2,362模块**，生成3组preload和HTML |
| `node scripts/package-desktop-surfaces.cjs` | 通过；核对3组preload/HTML及36段47,530,948字节桌宠动作素材 |
| `package-win.cmd --check` | 退出0；检查**13,871项资源**、生产依赖与版本1.3.5；未生成正式安装包 |

Windows看护单测主动模拟“原生窗口变为隐藏/最小化但未发Electron hide/minimize事件”，证明轮询后可恢复且用户主动隐藏不会复活；它没有按真实`Win+D`、`Win+M`或任务栏“显示桌面”，也未测普通/其他置顶进程实际遮挡、DPI/GPU、多屏、UAC或独占全屏。`screen-saver`是Electron窗口层级设置，不能保证高于所有系统级窗口。真实Windows Shell验收仍需单独进行，不把单测或打包预检描述为该验收。未生成NSIS/ZIP，未安装、发布或推送；版本、schema、协议修订号及用户数据目录未改变。

## 2026-11-22 / 生图保存与桌宠置顶补强

版本保持1.3.5。生图工作台已有的质量、分辨率、宽高、画面比例、透明背景、多张数和本地保存设置保留；本轮确认图片请求参数由共享schema校验后送入供应商请求，素材下载仍由主进程复核素材ID并打开系统保存对话框，不允许Renderer指定任意目标路径。

针对“置顶仍被其他窗口盖住”的反馈，Windows看护现在在窗口保持可见时每200ms重新申明topmost并调用`moveTop()`，覆盖未引发Electron `blur`/`hide`/`minimize`事件的可见遮挡；桌宠原生右键菜单打开期间暂停Z序重申，避免菜单被父窗口盖住。隐藏/最小化检测后等待120ms再用无焦点恢复，用户主动隐藏、关闭、禁用、取消置顶及退出保护保持不变。它仍是应用级恢复策略，不是Win32 Shell的置顶豁免；`Win+D`、cloaked窗口、独占全屏、UAC安全桌面、系统弹层和其他Windows会话仍需要实机验证，不承诺覆盖。

| 检查 | 本轮结果 |
| --- | --- |
| 生图及桌宠定向Vitest | **6个文件，101项通过**：参数验证/请求、多图存储、原图导出、隐藏恢复、无blur时周期性重提Z序及原生菜单期间暂停 |
| 完整串行Vitest | `pnpm --filter @mingshen/desktop exec vitest run --maxWorkers=1 --no-file-parallelism`：**198文件通过、3文件跳过；2,694项通过、15项跳过、0失败，294.48秒** |
| 根Node脚本套件 | `node --test scripts/*.test.cjs scripts/*.test.mjs`：**160项通过、0失败/取消/跳过** |
| 类型检查与Lint | `pnpm typecheck`通过；`pnpm lint`通过，Biome检查**523个文件** |
| 生产构建 | `pnpm build`退出0；main **171模块/2,162.20 kB**，renderer **2,362模块** |
| 桌面资源与打包预检 | `node scripts/package-desktop-surfaces.cjs`通过（3个preload、3个HTML、36段47,530,948字节动作）；`package-win.cmd --check`通过（**13,871项资源**、生产依赖及1.3.5） |
| `git diff --check` | 退出0；只有现有工作区LF/CRLF转换提示 |

所有自动化和构建检查通过，但本轮未运行真实Electron桌面自动化，也没有操作真实`Win+D`/`Win+M`或让另一款置顶程序遮挡桌宠；Windows Shell行为因此仍属未实测项。未生成正式NSIS/ZIP、未安装、发布、提交或推送；schema、协议修订号、用户数据目录、版本及图标均未改变。

## 2026-11-23 / NSIS 欢迎页插件解析修复

用户按正式入口打包时，Electron运行时准备、生产构建、13,871项资源预检和`afterPack`应用资源校验均通过；首次NSIS编译在`apps/desktop/build/installer.nsh`调用`StdUtils::TestParameter`时失败。官方`nsis-resources-3.4.1`缓存SHA-256与electron-builder内置校验值一致，且`plugins/x86-unicode/StdUtils.dll`存在，因此没有清理或改动任何全局缓存、依赖或上游运行时。

自定义欢迎页只需检测更新安装的`/updated`标记；现在改用NSIS内置`FileFunc.nsh`的`GetParameters`/`GetOptions`解析器，避免自定义include展开`isUpdated`时提前触发StdUtils插件调用。检测到更新仍跳过欢迎页；普通安装仍展示原有欢迎页和动画。

| 检查 | 本轮结果 |
| --- | --- |
| `node --test scripts/installer-visuals.test.cjs` | 首轮**4项通过**；当时的NSIS编译夹具未启用警告即失败，因此未能发现后续打包日志中的`warning 6010`。纠正及严格复验见下方后续记录 |
| `node scripts/installer-visuals.cjs` | 通过；图像资源、NSIS配置和欢迎页结构检查通过 |
| `package-win.cmd --check` | 退出0；**13,871项资源**、生产依赖与1.3.5通过 |

没有再次运行完整`package-win.cmd`，因此本记录不宣称正式安装包已成功生成；完整NSIS/ZIP构建、安装、升级及卸载仍需重新验收。未修改版本、schema、协议或产品数据，也未提交/推送。

## 2026-11-23 / NSIS 欢迎页未引用回调修复

用户重试正式打包后，原有`StdUtils`错误已消失，NSIS到达脚本编译，但因`warning 6010: install function "mingshenWelcomeLeave" not referenced`而失败；electron-builder将该警告升级为错误。该回调仅调用`mingshenWelcomeCleanup`，而欢迎页创建函数在`nsDialogs::Show`返回后已经调用同一清理函数，因此离开回调是冗余的。已删除这个未引用函数与第二个页面回调，普通安装动画及`/updated`时跳过欢迎页的逻辑不变。

加强`installer-visuals.test.cjs`的隔离NSIS夹具：以`/WX`将警告视为失败，匹配NSIS默认主语言和安装文件页序列，并断言编译输出无警告。该改动解决了原夹具未启用警告即失败、导致上次4项测试虽通过却漏报`warning 6010`的问题。

| 检查 | 本轮结果 |
| --- | --- |
| `node --test scripts/installer-visuals.test.cjs` | **4项通过**；真实`makensis`隔离夹具启用`/WX`，编译成功且输出没有警告 |
| `node scripts/installer-visuals.cjs` | 通过；installer图像、NSIS配置、更新参数检测、动画及清理回归断言通过 |
| `package-win.cmd --check` | 退出0；**13,871项资源**、生产依赖及版本1.3.5通过，不生成安装包 |
| `git diff --check`（本轮改动文件） | 通过 |

最初修复后完整`package-win.cmd`在正式NSIS阶段继续发现新的严格警告；后续修复与最终构建结果见下方“NSIS多语言警告修复与正式包完成”节。

## 2026-11-23 / NSIS 多语言警告修复与正式包完成

本轮正式重试先后揭示两个此前未覆盖的NSIS警告。`warning 6040`是electron-builder未指定`installerLanguages`时默认启用26种安装器语言，但自定义欢迎页只对英语LCID 1033和简体中文LCID 2052提供`MSH_SETUP_TITLE`/`MSH_SETUP_COPY`；越南语只是首先报告的缺失语言。未逐项伪造其他语言文案，也未关闭`warningsAsErrors`；在`apps/desktop/electron-builder.yml`中明确保留`en_US`和`zh_CN`两种完整安装器语言。`warning 6001`是欢迎页测试追帧条件代码遗留的`TraceFile`变量，正式构建未定义该测试宏，故删除无产品用途的变量和追踪分支。之前的`warning 6010`冗余离开回调已在前一节记录移除。

测试现在断言语言配置严格为`["en_US", "zh_CN"]`，并从该配置生成隔离NSIS fixture中的MUI语言宏；fixture在`/WX`下编译，确保任何警告都会失败。

| 检查与产物 | 实际结果 |
| --- | --- |
| `node --test scripts/installer-visuals.test.cjs` | **4项通过**；头图/侧图与8帧校验、现有图标、双语配置、严格NSIS编译均通过，无警告 |
| `node scripts/installer-visuals.cjs` | 通过；图像、NSIS配置、更新参数检测和动画/清理断言通过 |
| `package-win.cmd --check` | 退出0；**13,871项资源**、生产依赖与1.3.5版本通过 |
| 完整`package-win.cmd` | **退出0**；生产构建、afterPack资源校验、正式NSIS安装器与卸载器、更新ZIP及发布文件复制完成 |
| `MingshenHarness-1.3.5-x64.exe` | 379,004,650字节；ProductVersion/FileVersion均为1.3.5；SHA-256=`e5bb860cb8358069d465f28fdc07b94720fe3150d0ca2ab12f34c8a21b938200` |
| `MingshenHarness-1.3.5-x64.zip` | 378,071,417字节；SHA-256=`c7dec5c38ac1af95f737752bd44f82e0605b00fa0e8f736290665e971e9620e1` |
| ZIP旁路元数据 | `.sha256`和`.json`均存在；版本、文件名、大小与SHA-256均与ZIP实际文件匹配 |

交付文件位于`apps/desktop/release-artifacts/`。安装器未签名；本轮没有安装/启动新EXE，没有执行安装、升级或卸载流程，也未改变应用版本1.3.5、schema、协议修订号或用户数据目录；未提交或发布。
