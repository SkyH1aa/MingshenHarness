# Mingshen Harness 1.2.4 验证记录

核对日期：2026-11-04（Asia/Shanghai）。应用版本：1.2.4；协议修订：`2026-11-04.3`；数据库 schema：6。

## 设置输入焦点修复

用户反馈：设置 → 供应商与模型中选中输入框，输入几字后焦点会跳到右上角关闭按钮，无法持续编辑。

根因：`SettingsDrawer.tsx` 将首次聚焦、读取应用信息和 Escape 监听放在依赖 `onClose` 的同一 effect 中。`App.tsx` 传入内联关闭回调；每三秒审批同步或其他父级状态更新会改变回调引用，因此重新执行聚焦。输入框本身未主动移动焦点。

修复：将首次聚焦和应用信息加载限制为窗口挂载时执行，异步信息返回在卸载后不更新状态；Escape 监听单独跟随最新关闭回调。保留焦点可见样式、键盘关闭和正常按钮行为，不改审批同步机制。

## 实际执行结果

| 检查 | 结果 |
| --- | --- |
| 修复前真实 Electron 复现 | `settings-focus-smoke.mjs` 连续输入时失败，明确记录 `active=关闭设置` |
| 修复后专项 | 同一脚本 10 组通过，使用独立 OS 临时 profile、虚构本地凭据，不访问正常用户数据库 |
| 连续输入 | 中文/英文输入跨真实三秒审批轮询及主动窗口聚焦同步，焦点和已输入内容保持 |
| 光标与输入法 | 保留选区和光标，选区替换正确；Chromium 合成 IME composition 跨同步并正确提交中文模型名 |
| 真实配置保存 | 供应商名称、Base URL、Key 标签与密码、新增/替换 Key、模型 ID/显示名/上下文/输出上限/思考档均通过 IPC 保存并读回核对 |
| 键盘与窗口 | 首次打开和重新打开各初始化一次；Tab、Esc、关闭按钮正常 |
| 主题和布局 | 中文夜间及英文日间截图检查通过；1040×680 日间设置无页面溢出 |
| 内嵌文档 | 运行版本及中英文三协议、手册、更新日志共 10 份文档的 1.2.4 标识检查通过，无未捕获 renderer 异常 |
| `pnpm.cmd lint` | Biome 151 文件通过 |
| `pnpm.cmd typecheck` | 两套 TypeScript 配置通过 |
| `pnpm.cmd test` | 46 个测试文件通过、2 个跳过；246 项通过、8 项环境跳过 |
| `pnpm.cmd build` | main、preload、renderer 生产构建通过 |
| `node --test scripts/package-paths.test.cjs scripts/package-runtime-copy.test.cjs scripts/package-native-copy.test.cjs` | 13 项通过 |
| `.\package-win.cmd --check` | 22 项必需资源、生产依赖、版本 1.2.4 预检通过 |
| `git diff --check` | 通过；Git 提示仓库既有的 LF/CRLF 转换，不是空白错误 |

## 文档与分发

- 根包、桌面包、共享版本、ACP 桥、实验启动提示、打包入口和资源预检均同步 1.2.4。
- 中英文三协议仅更新适用软件版本；正文、生效日期、协议修订号和重新同意条件不变。手册增加设置编辑说明，日志增加独立 1.2.4 节，历史记录保留。
- README、安全说明、第三方声明、GitHub 授权说明、发布 SQL 示例及 AGENT/AGENTS 交接入口同步当前版本。SQL 仅编辑示例，未执行云端发布。
- 已构建当前源码。正常退出已有实验进程后，根目录运行 `.\run-experimental.cmd` 可运行该构建。
- 用户自行打包命令：`.\package-win.cmd`。预期产物：`apps\desktop\release-artifacts\MingshenHarness-1.2.4-x64.exe`。

## 同版本补充：历史问题导航

在上一轮焦点修复收尾后接入，版本保持 1.2.4。新增 `QuestionNavigator.tsx`，聊天区右侧每条短横线对应一条已发送的 user 消息；两条及以上时显示。预览从本地文本/附件提取，不调用模型，不解析为可执行 HTML，不改变原始消息或模型上下文。

ChatView 中 user 消息带稳定 ID；点击标记先暂停跟随并取消排队的滚动 frame，再定位原消息。阅读位置通过 scroll/ResizeObserver 更新并以 animation frame 合并；只自动滚动导航条本身，不使用可能连带移动聊天的 `scrollIntoView`。长列表支持独立滚轮、方向键与 Home/End；Enter 跳转、Esc 关闭预览。会话切换重置临时预览，编辑覆盖后的列表从有效历史重新生成。

| 检查 | 结果 |
| --- | --- |
| `node scripts/question-nav-smoke.mjs` | 真实 Electron 13 组通过，renderer CDP9355/main inspector9356，独立 OS 临时 profile/数据库，本地 SSE |
| 空历史及单问题 | 无导航条；两条以上按发送顺序显示，每个 user 消息一标记 |
| 鼠标与预览 | 真实 CDP 鼠标悬停显示问题标题、正文片段及附件名，点击定位原问题并更新当前标记 |
| 输入安全 | HTML 作为纯文本预览；长文本限长；附件单独发送也能定位，不触发脚本 |
| 键盘 | 方向键、Home/End、Enter、Esc 正常；鼠标移出不提前关闭仍被键盘聚焦的预览 |
| 普通滚动与流式 | 阅读标记随滚动变化；流式新增问题即时加入，跳转历史后新输出及完成均不拉回底部 |
| 长历史 | 119 条问题均能定位；导航条滚轮不移动聊天正文；编辑第 4 条问题后仅保留对应有效 4 条标记 |
| 会话切换与布局 | 不串用另一会话的问题；中文夜间、英文日间 1040×680 预览不出界；展开右侧工作面板时导航不覆盖面板，输入区和正文有间距 |
| `node scripts/settings-focus-smoke.mjs` | 最终构建重跑 10 组通过，包含真实配置保存、光标、合成 IME 及全部内嵌文档版本 |
| `node scripts/chat-scroll-smoke.mjs` | 10 项通过；测试中程序设 scrollTop 回底部后显式等待 scroll 事件稳定，再生成下一段，避免把尚未分发的合成事件当恢复失败 |
| `pnpm.cmd lint` / `pnpm.cmd typecheck` | Biome 152 文件及两套 TS 配置通过 |
| `pnpm.cmd test` | 最终 46 个测试文件通过、2 个跳过；246 项通过、8 项环境跳过 |
| `pnpm.cmd build` / `.\package-win.cmd --check` | 生产构建和 22 项资源预检通过，版本 1.2.4 |
| `git diff --check` | 通过 |

中英文手册、更新日志、README、DESIGN 和 AGENT 交接同步新增导航的行为。三协议在焦点修复阶段已同步适用版本，本次导航不改协议正文、修订号、schema 或云端配置。截图留于本地 `.impeccable/review`，不作为用户数据提交。没有新增依赖或生成安装包。

## 验证边界

本轮没有创建或安装 NSIS 安装包，没有真实付费模型请求、用户密钥访问或云端 SQL 修改。IME 使用 Chromium 调试协议合成输入，不代表所有实体输入法/辅助技术组合已经验收。未重跑 Docker、外部 MCP、BrowserDo/Embiody 或跨 Windows 环境矩阵；本记录不作全软件无 Bug 保证。

## 同版本补充：新建会话的四种 Agent

反馈：设置中存在四个默认配置，新建会话却只能选择 Plan 和 Mingshen。根因是 `NewSessionDialog.tsx` 将 `role === subagent` 的 General、Explore 从选项和备用默认值中过滤；聊天顶部与 SessionService 原本已接受这些已启用配置。

修复：新建列表统一按 enabled 筛选，优先选择已启用的 primary，缺失/禁用时回退其他已启用配置。无需改变用户配置中的角色、权限、只读标志、模型或数据库。General/Explore 用途说明明确支持独立会话。会话是否占子任务名额及禁止递归继续由 parentSessionId 判断，不按配置名称判断。

| 检查 | 结果 |
| --- | --- |
| `node scripts/agent-selection-smoke.mjs` | 真实 Electron 6 组通过，renderer CDP9357/main inspector9358，独立 OS 临时 profile |
| 新建菜单与默认项 | 四个默认配置均在列表中，初始仍选 Mingshen |
| 创建与保存 | 从窗口分别选择 Mingshen/Plan/General/Explore，均创建独立 root 会话，正确保存所选配置及 request_approval 权限 |
| 实际请求 | 使用本地 Responses SSE 分别完成 4 次请求，提示含正确 profile 与 depth 0；Plan/Explore 无文件修改/删除及 run_command 工具，Mingshen/General 保留写入工具 |
| 重载和语言 | 重载保持各自配置；中文夜间和英文日间显示四项用途说明，截图已检查 |
| 禁用及回退 | 仅启用 General 时列表仅有 General，默认选择且可成功创建，不回退已禁用的 primary |
| `vitest run src/main/sessions/session-service.test.ts src/main/chat/subagents.test.ts` | 7 项通过，含已有并发名额、取消、深度和只读/递归保护 |
| `pnpm.cmd lint` / `pnpm.cmd typecheck` / `pnpm.cmd build` | Biome 152 文件、两套 TS、生产构建通过 |
| `.\package-win.cmd --check` / `git diff --check` | 22 资源、版本 1.2.4 预检与空白检查通过 |

只同步相关中英文手册、日志及交接。本次未调整协议或版本、无新依赖和 schema 迁移；未重跑全套外部集成、未生成安装包。本地模型夹具验证真实请求构建及执行路径，不代表付费模型的回答质量认证。

## 同版本补充：用户自建 Agent

用户明确要求自建配置全部显示。新建会话和聊天顶部原本已按 enabled 筛选，不限制 builtin 或 role；本次将 AgentGuide 的用途说明从 builtin + enabled 改为全部 enabled，保留四个内置项的顺序，其余按名称排列。自定义名称和描述直接显示为文本，不改持久化配置。hidden 仅控制 @ 菜单，不作为直接选择条件。

扩展同一 `agent-selection-smoke.mjs` 后重验 **9 组通过、8 次本地模型请求**：从设置界面真实新建一个 Subagent，保存后无需重载即出现在新建、聊天顶部与用途说明；另建立 primary、plan、all 和已禁用配置，核对两个菜单的完整 ID 集合、描述、hidden 语义与禁用排除；四个自定义角色都从窗口创建独立会话，并验证实际模型请求使用各自指令、ID、depth 0 和只读边界。聊天顶部切换自定义配置后重载仍保留；原四默认配置与禁用/回退回归同时通过。

Biome 152 文件、两套 TypeScript、生产构建、脚本语法及 diff 空白检查通过。截图检查包含用户自建名称和描述，长说明在原有可滚动窗口内可访问。本次仍使用独立 OS 临时 profile 与虚构凭据，不读写正常用户数据；未调用付费供应商、未生成安装包。版本 1.2.4、协议修订和 schema 均不变，中英文手册及日志同步。

## 同版本补充：等待批准无面板的恢复

用户反馈有时左栏显示等待批准，但聊天区域没有可操作面板，只能停止重来。增加 `approval-recovery-smoke.mjs`，使用独立 OS 临时 profile、本地 Responses SSE 和真实受保护文件工具进行验证；不读取私人会话或凭据。

修复前，调试进程仅丢弃 `question_required` 事件即可复现：主进程保留问题并显示 waiting_approval，但超过 12 秒也不恢复提问面板。原有三秒轮询只查 ApprovalBroker，QuestionBroker 只有 bootstrap 与逐条事件恢复。另验证审批提交等待期间原界面没有状态行。加固期间新增“IPC 提交失败后按钮可用”断言，发现错误分支清空提交标记后未正确复位 busy，随后修复并重验。紧凑长草稿下的连续审批在修复前也已通过，未将其列为已证实根因。

当前修改：

- QuestionBroker 增加单调 revision 和完整 `QuestionState`，通过 bootstrap、`question:state` IPC 及 `question_state` 事件同步；保留 bootstrap 原有 pendingQuestions 字段。
- App 将两类 pending 都交给权威完整快照维护。旧/相同 revision 忽略，逐条事件只触发读取；聚焦、切换会话与三秒轮询覆盖事件丢失。审批回执、结束及重写事件不再直接按会话清空面板。
- ChatView 用审批 ID 和每次提交对象隔离异步回调。提交立即显示状态，五秒仍未确认则恢复人工按钮和重试提示；提交异常恢复按钮。迟到旧结果不隐藏/改变新审批。新请求使输入区回到可见起点，不移动聊天历史阅读位置。
- 缺少面板时显示恢复状态与刷新入口。恢复只读取状态，不自动批准、不改权限。主进程还有任何审批/提问时继续保持 waiting_approval，避免完成其中一项后过早置 running。

| 检查 | 结果 |
| --- | --- |
| `node scripts/approval-recovery-smoke.mjs` | 真实 Electron 6 组通过，renderer CDP9359/main inspector9360；本地6轮场景共18次聊天请求 |
| 事件丢失 | 仅在测试调试进程丢弃提问或审批事件；轮询恢复，连续提问可回答，切换会话不串请求 |
| 审批提交 | 模拟IPC拒绝后按钮恢复；八秒延迟时先显示提交状态、五秒恢复待处理控件，随后真实审批继续；旧回执不清下一条 |
| 布局与重载 | 1000×680、长草稿、输入区已有滚动、中文夜间与英文日间；新审批可见，重载恢复待处理项；本地截图已检查 |
| 权限 | 允许后真实原生隔离工具写入临时文件；拒绝后对应文件不存在；未增加隐式授权或宿主执行回退 |
| 状态单元测试 | 审批/提问混合等待、revision与队列、取消及旧快照保护；相关4文件14项通过 |
| `node scripts/approval-smoke.mjs` | 最终构建13组通过，含旧回执、重载、项目全访问、自动通过/拒绝/无效/503、两会话并发、停止清理及主备切换；13次主审核、5次备用审核均为本地夹具 |
| 自建 Agent 回归 | 最终构建9组通过，8次本地模型请求；从设置新增立即显示、所有角色可创建并运行独立会话，重载保留 |
| 设置焦点回归 | 最终构建10组通过，连续输入、选区、IME、Key/模型保存、日夜主题及十份内嵌文档版本 |
| `pnpm.cmd lint` / `pnpm.cmd typecheck` | Biome153文件及两套TS通过 |
| `pnpm.cmd test` | 47文件通过、2文件跳过；251项通过、8项环境跳过 |
| `pnpm.cmd build` / `.\package-win.cmd --check` | 生产构建与22项资源/生产依赖/1.2.4预检通过，未创建安装包 |

测试里的事件丢弃与延迟仅通过调试器注入到临时实例，不加入产品后门。中英文手册、日志与交接同步，三协议实质条款、协议修订和schema不变；未重跑付费网关、外部MCP、Docker或跨Windows矩阵，不作为所有用户电脑上故障全部消除的保证。

审批回归曾有一次在备用模型菜单展开后、点击前遇到菜单关闭，脚本取到undefined而失败。将该测试步骤改为同次检查与点击，并在菜单被scroll关闭时重新展开；最终13组重跑通过。该次属于测试操作竞争，未据此宣称修复产品模型菜单。首次协议同意步骤也改为等待按钮可用，调试器在退出前断开，避免固定sleep及inspector退出等待干扰结果。

## 同版本补充：Agent 主动结构化提问

参考[Codex request_user_input schema](https://github.com/openai/codex/blob/48524f337a84b570f0c2453ca43ec9a1a29375c0/codex-rs/core/src/tools/handlers/request_user_input_spec.rs)与[处理逻辑](https://github.com/openai/codex/blob/48524f337a84b570f0c2453ca43ec9a1a29375c0/codex-rs/core/src/tools/handlers/request_user_input.rs)的稳定问题ID、标题/描述、客户端Other及等待真实回答做法。保留Mingshen已有ask_user工具名与调用链，按本次需求扩展多选与每题最多四选项，未照搬Codex的模式限定。

### 实现

- 工具定义采用questions数组（1–3题），每题id/header/question/multi_select/options；选项0–4项、label+description，Other由应用提供。旧单题仍兼容，空选项可自由输入。
- core/tools/runtime提示明确教模型：缺失关键需求或偏好时主动调用，等待真实回答再继续；无需反复确认已知事实，不用普通文字问题代替可用工具。模型主动判断的质量不作保证。
- shared/questions统一检查上限、唯一性、长度、标题/描述和回答。单选不能多选或同时加Other；多选可附Other。回答按ID关联，全部题有效才消费pending；无效回答继续等待。Broker保留60秒幂等以忽略旧回执，取消不产生答案。
- 真实root会话（含Plan与自建配置）按既有tool policy获得工具；委派child从工具表及执行路径拒绝ask_user，疑问交父Agent，符合既有subagent指令。模型不支持toolCalls或显式禁用时不能冒充工具可用。
- AgentQuestionPanel单独承载单选/多选、Other、三题翻页、统一提交、错误重试、五秒未确认恢复、键盘和中英文；普通composer等待时收起，停止保留。工具记录持久化结构化答案并通过原三协议发送给模型续跑，不新增消息副本或数据库字段。
- 新增等待回答状态，沿用revision快照/重载/聚焦/轮询恢复；回答不是权限授权，full_access或自动审批不能代答。未提交选择只保留当前面板/翻页和失败重试，不宣称重载草稿持久化。
- 修复此次紧凑窗口发现的布局问题：app-body隐式auto行与sidebar默认min-height:auto被多会话撑高；显式minmax(0,1fr)及min-height:0保持聊天在窗口范围。问题正文独立滚动，提交/停止可见。
- 本地回环API与SDK支持结构化answers，旧文字answer保留。无效回答400且不消费请求，鉴权/Origin边界沿用原实现。

### 验证

| 检查 | 实际结果 |
| --- | --- |
| 新增提问专项单元 | 共享规范化6项、生命周期4项、broker新增1项、提示词新增1项，及本地API中结构化回答校验覆盖 |
| `node scripts/agent-questions-smoke.mjs` | 真实Electron9组、18次本地模型请求；三协议实际构建、SSE解析、工具结果回传和同任务续跑，非付费模型 |
| 单选/多选 | 四个标题描述选项+系统Other，radio互斥、键盘方向键，多选勾选/取消与自填组合，空Other不能提交 |
| 多题/格式 | 三题回看保留当前批次选择，按id回传；legacy开放问题、HTML纯文本、第五项报错后模型纠正 |
| 生命周期/错误 | 真实等待不额外请求模型，提交失败保留选择并恢复按钮，Plan可提问且权限不变；重载恢复、停止清理且不代答，Ctrl+Enter续跑 |
| 布局 | 中文夜间、英文日间1040×680；问题正文滚动、提交和停止可见，多会话不撑出主窗口；截图已检查 |
| 审批回归 | 审批恢复6组、原审批13组（主13次/备5次本地审核）通过 |
| 聊天与会话回归 | 通用桌面21项、会话命令11组、自动压缩9组、CTX恢复6组、滚动10项、导航13组、Agent选择9组、焦点10组通过 |
| 其他桌面 | 1.2.2目录/文档6组、1.2.3布局/GitHub夹具/子任务6组、会话操作4组通过 |
| 通知 | Windows原生XML/COM快捷回复、失败草稿两种流程及中英文设置/内嵌手册通过 |
| 原生隔离/路径 | 原生MXC实际2项通过，junction/路径遍历/Git元数据防护通过，临时外部sentinel未改变 |
| `pnpm.cmd lint` / `pnpm.cmd typecheck` | Biome157文件、两套TypeScript通过 |
| `pnpm.cmd test` | 49测试文件通过、2跳过；263项通过、8环境项跳过 |
| `pnpm.cmd audit --prod` | 无已知生产依赖漏洞 |
| 打包与图标脚本 | 14项通过；不生成NSIS，原子图标与版本未变 |
| 最终构建与资源 | main/preload/renderer构建通过，22项资源与1.2.4版本预检通过，SDK脚本语法与diff空白检查通过；最后提问9组再次通过，含紧凑错误提示布局 |

两次专项初期因紧凑布局失败，修复主网格/侧栏高度后重验通过，不略过失败。旧v123会话脚本仍期待菜单第二项“置顶”及四项菜单，与已存在分支入口不符；仅更新测试预期，4组重跑通过。通知探测最初遇到历史条目Content为空，补齐WinRT XML类型及空条目处理后原生/失败两模式重跑通过，未改产品通知行为。

中英文手册与更新日志、README、DESIGN和AGENT同步，应用1.2.4、协议2026-11-04.3、schema6不变，无依赖新增。三协议未涉及实质条款变化，不调整重新同意门槛。测试使用临时profile及本地夹具，不触碰用户Key/DB、不执行SQL、不生成或安装NSIS。付费供应商语义质量、外部凭据MCP、跨Windows矩阵与正式安装/升级未验证；BrowserDo/Embiody按用户要求免测。全量源码与主要桌面回归不等于无Bug或安全认证。

## 同版本补充：回到底部与恢复自动跟随

核对日期：2026-11-05。应用版本1.2.4、协议修订`2026-11-04.3`、schema6不变。

- 聊天暂停跟随后，底部提供“恢复自动跟随”；不在尾部时额外显示向下箭头。箭头一次跳到最新内容但仍暂停；恢复按钮跳到底部并跟随后续输出，控件收起。再次上滑暂停，手动滚回底部仍恢复原有跟随行为。
- ChatView同步atBottom/following布尔状态，不把控件放进流式消息中。暂停时ResizeObserver仍检查位置，后续输出使箭头重新出现；按钮采用现有主题/Lucide/中英文，并放在聊天区底部、输入区及问题导航之外。
- 一次跳转同步previousTop，防止自身scroll事件误当作手动下滑恢复跟随。取消排队frame；已在底部时不排多余frame。内容收缩造成的scrollTop钳制不当作用户上滑，空会话无溢出时不显示多余控件。
- 按钮支持Tab/Enter。一次跳转后焦点转到仍保留的恢复按钮；恢复后焦点回到聊天记录，避免隐藏当前按钮导致键盘焦点丢失。历史问题导航复用暂停跳转路径。

| 检查 | 实际结果 |
| --- | --- |
| `node scripts/chat-scroll-smoke.mjs` | 真实Electron19项通过，使用临时profile及本地Responses SSE，无未捕获renderer异常 |
| 核心滚动 | 初始跟随、上滑保持、一次跳转不跟随、后续增长重新显示箭头、键盘恢复后文本/思考持续跟随、再次上滑、手动回底部恢复、小幅上滑取消frame |
| 生命周期 | 思考区折叠/展开不误暂停、完成仍保持阅读位置、完成后的两个操作可用、连续四次切换空会话及历史会话，空会话无多余按钮 |
| 布局 | 中文夜间及英文日间1040×680截图已查看；按钮最小36px、文本无溢出、位于聊天区内且输入区上方 |
| `node scripts/question-nav-smoke.mjs` | 13组回归通过；含119条历史、流式跳转、键盘、右侧面板、中英文日夜紧凑窗口，追加断言滚动按钮不覆盖问题导航和输入区 |
| `pnpm.cmd lint` / `pnpm.cmd typecheck` | Biome157文件、main/renderer两套TypeScript通过 |
| `pnpm.cmd build` / `pnpm.cmd package:check` | 生产构建、22项资源/生产依赖与1.2.4版本预检通过；未生成安装包 |

专项早期出现切换空会话与立即上滑时的间歇失败；修正内容收缩误判及多余滚动frame后，最终19项与导航13组全部通过，没有删去对应断言。仅更新中英文内嵌手册和日志、验证及交接，三协议无实质变化。本次未重复付费模型、外部MCP或隔离测试，不把桌面滚动检查称为全功能或NSIS验收。

## 打包前复核（2026-11-05）

按用户要求只检查并提供打包命令，未生成安装包或新的解包应用。

| 检查 | 实际结果 |
| --- | --- |
| 用户入口 `.\package-win.cmd --check` | 自动找到Node/pnpm，22项必需资源、全部生产依赖及1.2.4版本一致性通过 |
| 打包/图标脚本测试 | 路径边界、EPERM有限重试/内容验证、Windows原生复制、builder私有暂存移动及实验EXE图标恢复，共14项通过 |
| 构建与静态检查 | main/preload/renderer生产构建、Biome157文件及两套TypeScript通过 |
| 内嵌文档 | 三协议、使用手册和更新日志的中英文共10份均标识1.2.4；三协议修订`2026-11-04.3`一致；手册/日志已覆盖最新滚动、提问、审批恢复与Agent选择 |
| 文档读取 | DesktopController专项1项通过，覆盖中英文版本、文档读取、五秒/三协议同意门槛及旧修订重新同意 |
| 资源及安装配置 | docs资源映射、提示词/LSP/SDK/沙箱及许可、生产依赖、原子PNG与多尺寸ICO保留；Windows x64 NSIS、当前用户安装、未签名、可选择目录及桌面/开始菜单快捷方式 |

用户自行执行根目录`.\package-win.cmd`，输出`apps\desktop\release-artifacts\MingshenHarness-1.2.4-x64.exe`；该入口会重新构建并在afterPack再次检查随包资源。Docker Desktop/WSL2/Embiody仍是官方独立依赖安装，不包含其完整安装环境。此次检查不等于已经完成NSIS安装、卸载或升级验收，无需改变应用版本、协议或数据结构。

## 同版本补充：会话目录在资源管理器中打开

核对日期2026-11-05，应用1.2.4、协议`2026-11-04.3`、schema6不变。

- 左侧会话三个点菜单新增“在资源管理器中打开”及Open in File Explorer。无需先切换会话，运行中也可使用。无目录禁用并说明原因；六项菜单加宽为224px并限制在视口内，沿用现有图标、日夜主题及键盘行为。
- shared/preload/main新增`session:open-workspace`，仅接收会话ID，可信renderer与协议门槛沿用统一IPC。DesktopController从Repository查询最新路径；会话仍处worktree模式且本次运行已有对应worktree时使用实际目录，否则打开配置路径，不为查看动作创建worktree。
- 主进程检查会话/目录、绝对路径、现存目录类型，拒绝空值、相对路径、网络/设备路径；使用Electron shell.openPath，不拼Explorer或shell命令、不执行文件。目录失效/原生失败通过应用内侧栏显示，英文模式翻译错误，不改变会话、工作文件或权限。
- 更新中英文内嵌手册和日志。三协议未涉及条款变化，无需修改正文或重新同意条件。

| 验证 | 实际结果 |
| --- | --- |
| DesktopController专项 | 共2项通过；新增覆盖中文/空格和.cmd目录、缺失ID/目录、无目录、相对/UNC/设备/NUL、误配文件、shell失败及worktree实际路径选择 |
| 完整源码测试 | 49测试文件通过/2跳过；264项通过、8环境项跳过 |
| `node scripts/v123-conversation-smoke.mjs` | 真实Electron6组会话回归；实际打开非选中会话的中文空格目录，Shell COM核对路径，不切换当前会话；仅关闭该测试目录窗口 |
| UI边界与回归 | 无目录禁用，目录删除提示、原生错误夹具及英文错误；运行中入口可用，中文夜间/英文日间1040×680截图核对，六项菜单无溢出；保留键盘/重命名/置顶/归档恢复/删除及原文件 |
| 静态/构建/打包 | Biome157文件、两套TS、main/preload/renderer生产构建及22资源预检通过；未生成NSIS |

测试先修正跨目录分组折叠的旧假设，调试器中使用现有createRequire方式加载Electron，并将运行计时固定sleep改为等待实际状态，最终回归通过。原生打开失败仅在独立测试进程内夹具，不加入产品开关；所有数据为OS临时目录、本地模型，不访问用户Key/数据库，不调用付费供应商或免测的BrowserDo。打包由用户执行`.\package-win.cmd`。
