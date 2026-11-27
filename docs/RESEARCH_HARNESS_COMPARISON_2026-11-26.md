# Mingshen Harness、OpenCode 与 DeepSeek Harness 产品对比

调研日期：2026-11-26（Asia/Shanghai）。本地基准：Mingshen Harness **1.3.7 当前工作树**，包含正式包之后的断流重试修复。本文是产品与工程调研，不是三款产品的同模型性能测试，也不是竞争产品的安全审计。

## 1. 结论

Mingshen 的特点是把中文 Windows 编程、Office 交付、创作模板、持久图片画布与普通聊天放在同一个本地工作台。已有的后台子 Agent、QA 总控、Skill/插件发现、Worktree、终端、记忆和检查点均有源码实现，不能把这些重复列为“需要从零新增”的功能。

OpenCode 2 最值得借鉴的是围绕同一个服务构建 CLI/TUI、Web、Desktop、远程移动端与开发者接口，以及持久子会话、Code Mode、可扩展 Worktree 和组织硬策略。DeepSeek Harness 的特点是可替换核心组件的插件运行时、统一工具输入/输出契约、Agent Teams 共享任务板、丰富的时间规则与 Office 渲染/重算底座。

**下一轮最有价值的方向是可靠性与交付质量，而不是继续增加入口数量。** 优先补齐模型流超时、恢复后的副作用核对、Office 成品验收、插件契约和可重复评测；随后扩展调度、多端接口与组织治理。没有相同模型、相同任务、相同预算的实测，不能据此断言任何一款“代码更强”“更省 Token”或“PPT 更好看”。

## 2. 对象与证据口径

| 产品 | 本次采用的官方对象与版本 | 证据边界 |
| --- | --- | --- |
| Mingshen Harness | 本仓库 `1.3.7` 当前源码；Windows 10/11 x64 | 本地源码、全量自动检查与隔离 Electron 回归。现存安装器未包含后续断流修复，本轮未重新打包 |
| OpenCode | Anomaly 的 `anomalyco/opencode`，当前 V2 `2.4.2`，2026-11-26 发布；npm 包为 `@opencode/cli` | 官网 V2 文档、对应 Release、npm 元数据及官方源码静态核对；未安装运行 [O1][O2] |
| DeepSeek Harness | DeepSeek AI 的 `deepseek-ai/deepseek-harness`，CLI 名 `dsh`；npm `latest` 与官方稳定桌面 feed 为 `0.2.2-rc.5` | 当前 `master` 为 `4b399c39a6d1479cd84ca591b4d7c88e24d38a96`，对应 `dsh-v0.2.3-alpha.2`。功能分析包含该预览源码的文档，不能全部视为稳定安装包行为 [D1][D2][D3] |

版本辨析：OpenCode 的 `/releases/latest` 和旧 npm 包 `opencode-ai` 核对时仍指向 V1 `1.19.6`；当前 V2 要结合官网 Changelog、`@opencode/cli` 和具体 V2 tag 判断。`opencode-ai/opencode` 是已归档的另一早期 Go 项目，其后续为 Crush，不能混入本次比较。DeepSeek 官方官网直接链接上述 Harness 仓库；同名 Python 项目和第三方桌面封装不作为官方功能依据。[O1][O2][O3][D1]

证据分为三层：**源码存在**说明入口已实现；**本地验证**说明受控场景通过；**真实集成验收**需要真实供应商、复杂文件或目标设备证据。本文将“未查到官方证据”与“确定没有此功能”分开处理。外部项目没有在本机安装、启动或调用付费模型；没有下载执行其插件和脚本。

## 3. 本轮全量检查

| 项目 | 本轮结果 | 说明 |
| --- | --- | --- |
| 完整 Vitest | **207 文件，204 通过、3 跳过；2,890 项通过、15 跳过、0 失败** | 694.74 秒；本轮 JSON `v137-retry-full-vitest-20261126.json`，不沿用旧版的 2,887 项 |
| 根 Node 脚本测试 | **163/163 通过** | 涵盖资源、Windows 打包脚本、复制/锁定、图标及安装界面脚本等；不是正式安装验收 |
| 类型检查 | **通过** | `pnpm typecheck`，Node/Web 两套 |
| Lint | **通过** | Biome 检查 532 文件 |
| 生产构建 | **通过** | main 173 模块、renderer 2,363 模块、三组 preload |
| 打包预检 | **通过** | `package-win.cmd --check` 核对 13,871 项资源、生产依赖闭包与版本 1.3.7 |
| 隔离桌面回归 | **断流重试 10 组；生图/已读 14 组通过** | 临时 profile、本地合成服务；具体证据和中途失败记录见 [本轮验证记录](VALIDATION_1.3.7.md) |
| 生产依赖审计 | **未通过：3 项 moderate，0 high、0 critical** | `pnpm audit --prod` 退出 1；没有把适用路径分析当成漏洞修复 |

跳过的 15 项包括真实 Office COM、Docker/原生沙箱、外部 MCP/GitHub/市场集成和两项目录链接条件测试；三份整文件跳过属于显式启用的现场集成测试。本轮没有启用这些环境开关。其他 Windows junction、文件锁、受控提交、真实 PTY 和进程取消测试仍有实际执行，不能把所有文件边界测试统称为跳过。

重点复核包括模型重连与工具历史、模式权限、协作与恢复、Office、插件、调度、图像协议/URL 保存、版本和资源。自动检查覆盖全仓配置与测试集合，人工源码复核集中在这些路径；**不声称逐行人工审阅所有源码或证明不存在致命问题**。

### 仍需处理的已知事项

1. **模型流空闲超时尚未统一实现。** 重试已固定为每次请求额外 0–20 次，半截输出不续期；但连接长期保持、不报错也不结束时，仍缺少首包/流空闲 watchdog。90 秒网页请求预算不能替代模型流超时。[M1]
2. **三项中等依赖公告仍在。** 路径为 `exceljs > uuid` 和 `browserdo-mcp > @modelcontextprotocol/sdk > @hono/node-server`。当前 ExcelJS 使用 UUID v4，BrowserDo 默认使用 stdio，未走公告涉及的相关 API/HTTP 路径；这缩小现行暴露面，没有消除依赖债务。[V]
3. **许可证声明不一致。** 根目录确有 MIT `LICENSE`，两个包的 `license` 仍为 `UNLICENSED`，旧 README/交接又写成没有根许可证。应统一这些声明及分发材料；本轮纠正文档事实，没有替维护者更改许可元数据。[M2]
4. **当前源码与现存安装器不同。** 本轮构建产物包含断流修复，但没有重新生成 NSIS/ZIP；安装、升级、卸载和代码签名也没有本轮验收。[V]
5. **现场矩阵仍不足。** 真实付费供应商、复杂 Office、磁盘满、杀毒竞争、系统代理和完整 DPI/辅助技术矩阵不能由夹具测试代替。

## 4. 产品能力矩阵

### 4.1 工作场景与交互

| 维度 | Mingshen Harness 1.3.7 | OpenCode 2 | DeepSeek Harness |
| --- | --- | --- | --- |
| 主体定位 | 中文 Windows 本地编程、办公、聊天与创作工作台 | 以开发工作流为核心的多端 coding agent | 通用插件化 Agent Harness，官方同时展示编码与办公 |
| 客户端/平台 | Electron GUI；正式分发 Windows x64；另有本地 API/ACP 桥 | CLI/TUI、mini、Web、Desktop、移动远控、ACP/SDK；多平台二进制。Desktop/移动端仍有 Beta/early 状态 | Node CLI/Web，官方 Windows x64、macOS arm64 桌面下载；开发者预览。CLI/Web 与桌面渠道需分别看版本 |
| 模式 | Code/Work 共用工作区与历史；Chat 独立且只开放联网与上传附件只读问答 | Build/Plan 等主 Agent、自定义 Agent 与子 Agent；未核实等价的内置受限 Chat 工作面 | Agent/插件组合与 Session；未核实等价的三模式成品划分 |
| 代码工作 | AST 索引、LSP、格式化、编辑/补丁、命令、真实终端、diff 评论、Git/Worktree | 持久开发会话、后台子 Agent、Worktree 策略、Code Mode、自定义工具和开发者接口 | 文件/命令工具、子会话、插件化执行与结构化工具链；不能仅凭架构推断代码生成质量 |
| 办公交付 | Word/Excel/PPT/PDF 生成和受控旧稿编辑、OCR、原生公式、主题与版式，按条件做 Office COM 检查 | 可借助 Skill、插件、MCP、shell 处理文档；本轮未确认与 Mingshen 等价的第一方 Office 成品工作流 | 第一方 Office Kit 提供转换、渲染、公式重算，使用 LibreOffice 原生或 WASM 回退；不代表业务正确或版式已验收 |
| 创作模板 | 780 个场景，简略/详细版本，技能推荐与分节草稿交接 | 未查到等价的第一方 780 场景工作站；扩展生态可补充 | 未查到等价场景数量与同款模板库；插件可提供工作流 |
| 生图与画布 | 专用 Images 协议、参考图、本地画布库、素材管理、提示词回导、批量导出与 URL 确认保存 | 源码涉及图像/视频后台任务；本轮未确认与 Mingshen 等价的持久画布、素材库和提示词回导界面，不能概括为“没有图像能力” | 插件可扩展媒体能力；本轮未确认等价的第一方画布/素材工作台 |
| 桌面陪伴 | 透明桌宠、任务状态、快捷 Chat、全局快捷键、启动展示 | 本轮未确认等价第一方桌宠 | 本轮未确认等价第一方桌宠 |

本表 Mingshen 对应模式、Office、模板、图片与桌面路径见 [M3][M4][M5]；外部证据见 [O3][O4][O5][D1][D4]。780 是由任务结构与场景组成的提示词工作流数量，简略/详细不重复计数；不是 780 个成品 Office 文件，也不是审美或专业质量评分。

### 4.2 执行、恢复与验证

| 维度 | Mingshen Harness 1.3.7 | OpenCode 2 | DeepSeek Harness |
| --- | --- | --- | --- |
| 后台子 Agent | 已有立即返回的 `spawn_subagent`、等待/跟进/状态与后台父任务；默认并发 3、可设 1–8；实际子任务不递归派发 | 独立持久 child session，立即返回 ID，空闲回报，可跟进运行中任务；默认嵌套深度 1。公开材料没有统一全局并发配额承诺 | 持久子会话、父子消息、继续执行、Steering、容量限制和结构化输出；团队任务板另成机制 |
| 多角色总控 | 18 个内置角色；总控拆工作包、并行执行、父验证、独立 QA 和实时事件 | 自定义 Agent、并行会话、子会话；本轮未确认与 Mingshen 相同的内置 18 角色 QA 面板 | 可选 Agent Teams：共享任务板、依赖 DAG、认领、revision CAS；默认不启用 |
| 引导与队列 | 运行中引导进入下一模型请求；正常结束后按 FIFO 自动发送，最多 10 条 | 支持 steer/queue、interrupt、持久 Session；已有请求与外部操作不能被事后改写 | 子会话 Steering、中断、收件箱与 Session 调度；能力语义须按具体插件看 |
| 项目/分支与计划 | 本地项目、分支/Worktree 分组、多项目导航、四种 diff 范围与行评论；持久计划库、依赖/循环校验、断点、revision 冲突保护、跨会话复用，绑定时可选重置完成状态 | Worktree create/list/remove、Session 移动工作区、可扩展策略与多端项目会话 | 有 workspace/沙箱/Session 与团队依赖任务板；本轮未确认等价的第一方分支 diff 评论界面 |
| 崩溃后恢复 | 启动把运行状态标为 interrupted；保存安全工具边界、计划和不确定操作，用户可点恢复。协同旧任务不会伪装仍在运行 | V2 源码有 durable execution claim 和重启续跑；属于 at-least-once，单 turn 默认最多恢复 10 次，Code Mode 脚本不能普遍 suspend/resume | JSONL/SQLite 追加会话记录，补写未结束 turn 的中断记录；不能据此宣称整个任务自动续跑或外部操作回滚 |
| 文件回滚 | 自有文件快照、受控提交/恢复、写屏障；命令/MCP/外部副作用没有通用事务 | Git active worktree 的 best-effort snapshots 与 undo/redo；ignored、大型 untracked、外部路径和远程副作用不在恢复范围 | 存储/会话恢复与沙箱分层；本轮未确认与 Mingshen/OpenCode 等价的第一方任意文件快照回滚 |
| 工具契约 | 参数使用 Zod 等校验，统一结果类型包含输出、错误、图片、文件变更和 Office 状态；未发现所有工具均执行统一输出 JSON Schema 的承诺 | 支持工具/插件类型及 Code Mode 编排；本轮未确认所有工具都采用 DSH 同款 canonical 输出强校验 | 工具参数与 canonical 输出均执行 JSON Schema，区分 `INVALID_ARGS`/`INVALID_TOOL_OUTPUT`，模型只见白名单字段 |
| 结果质量 | 已有验证状态和独立 QA，但需要真实命令/产物证据；本轮未完成跨产品同题验收 | 工具运行和快照不自动证明业务正确；不能把 coding 定位当成性能评测 | I/O Schema、审批和 Trace 证明执行结构，不能自动证明文档质量或业务计算正确 |

依据：[M1][M6][M7][M8][O6][O7][O8][D5][D6][D7][D8]。三款都不能只因保留历史、标记成功或存在快照就声称 arbitrary shell/远程 MCP 操作恰好执行一次。Mingshen 本轮证明的是客户端不重放已完成工具、未完成调用不执行；不能保证模型后续不会再次主动请求相同操作。

### 4.3 扩展、调度与治理

| 维度 | Mingshen Harness 1.3.7 | OpenCode 2 | DeepSeek Harness |
| --- | --- | --- | --- |
| 模型接入 | 五种协议，多供应商/Key/模型；文本与图片用途分开，缓存配置与诊断 | Models.dev、内置多种 runtime、自定义 provider 包与多种认证；V1 的“75+”数字不直接当成 V2 兼容验收 | 模型层本身是可替换插件；Harness 不绑定只有 DeepSeek 模型 |
| 上下文压缩与缓存 | 自动/手动摘要压缩、主备压缩模型与 Token Saver；供应商缓存配置、原生状态续接与 usage 诊断，实际命中及计费由上游决定 | 自动/后台摘要，可选 Responses 原生压缩；缓存断点、TTL 与 warming 编排。原生 checkpoint 有同供应商/模型边界，warming 会产生真实用量 | 官方第一方可选压缩插件，支持压力/溢出触发、手动/区域压缩、工具结果剪枝与图片省略；归一化供应商缓存用量，LLM 服务自身不提供通用缓存 |
| 跨会话项目记忆 | 按工作区选择原生 Markdown Memory 或 TencentDB 本地 L1 core；支持检索、写入、编辑、遗忘，原生另有归档。本地存储，语义提取仍可发送到所配置供应商 | 已核实持久 Session、摘要与项目指令；本轮未确认与 Mingshen 等价的第一方项目记忆编辑/遗忘工作流，Skill/MCP 可扩展 | 本轮未确认内置长期 Memory 存储；官方 MCP Client 提供 Memorix、Reference Memory、Engram 参考配置，默认关闭，存储/检索由外部 Memory Server 负责 |
| Skill | 内置/安装发现、按需加载、手动引用、模式适用范围、同名非变体版本合并 | 本地/兼容目录/HTTP catalog，向模型提供元信息后按需加载正文 | Skills 可由插件组合提供并按需使用 |
| 插件深度 | `.mingshen-plugin` 清单、Skills/命令/MCP/受控 Hook、本地开发市场与用户确认更新 | npm/本地/Git 插件；可扩展 server、TUI、GUI、RPC、工具、Agent、Hook、transform，含 cleanup/reload | Everything is a Plugin：模型、工具、Loop、Session、沙箱、存储、调度都可组合替换；兼容检查、更新与回滚 |
| 逐次请求 Hook | `BeforeModelRequest` 已有 before/after、context/plain，并覆盖受支持轮次与重试；不是任意核心服务替换 | `model.request`、HTTP、retry、compaction、permission、tool 等更广 Hook；部分仍实验性 | 以 Cordis 服务和插件生命周期组合核心，不宜硬套成 Mingshen 的某一个 Hook |
| MCP | 本地/远程与 OAuth，权限控制、工具分页结果、插件声明 | stdio/HTTP/OAuth、prompts/resources、可选连接池；V2 Code Mode 默认通过命名空间调用 | 作为插件能力接入并受执行/审批体系约束 |
| 定时任务 | **已有**固定间隔 1–10,080 分钟、15 秒扫描、绑定会话、启停/立即运行。启动发现过期任务可触发一次；下一次按本次触发时间计算 | 本轮未核实与 DSH 同等级的第一方 cron/RRULE 调度 UI；CLI/CI 可以外接系统调度 | 一次性、间隔、日/周、cron、RRULE、IANA 时区；当前 Session/首次新建后复用/每次新建三类目标 |
| 权限与隔离 | Code/Work 审批、Profile 限权、工作区信任，受保护工具选择 MXC/Docker；宿主 Full Access、交互终端和批准的第三方扩展另有边界 | ordered allow/ask/deny；V2 基线大多 allow，`.env`/`.env.*` 默认 ask、外部目录默认 allow；项目插件可自动发现。官方明确权限及 policies 都不隔离插件代码，shell 使用宿主权限；真正隔离建议外部 Docker/VM | 审批 fail closed；命令有 bwrap/Landlock、Seatbelt、Windows ACL 等后端。Windows 可为 partial，网络/进程可见性不由这套文件写策略全面承诺 |
| 组织治理 | 本地配置与 Profile；未发现组织硬策略下发、企业 SSO/RBAC、集中审计和管理控制台 | `policies` 可由 system/managed/Console 下发，只能收窄，项目无法放开组织拒绝；不因此推断完整企业 SSO/RBAC | 本轮未确认与成熟企业控制台等价的第一方 SSO/RBAC；团队任务板不能当作组织治理 |
| API/多端 | 可选回环 HTTP API、随包 SDK、ACP 桥；还不是经独立验收的完整 CLI/IDE/移动端体系 | `run`、后台 service、HTTP/OpenAPI、ACP、JS/TS SDK/client、远程配对。V2 API 明示 Experimental，事件订阅并非历史回放保证 | `dsh web`、桌面/Web 和插件 Host；开发者接口与部署文档，仍在快速破坏性迭代期 |
| 许可 | 根 MIT 文本与 `UNLICENSED` 元数据冲突，待统一；第三方权利单独保留 | MIT | MIT；官方服务条款与源码许可另行适用 |

依据：[M2][M9][M10][M11][M12][O9][O10][O11][O12][O13][D9][D10][D11][D12][D13][D14]。协议数量不是供应商数量；可配置供应商也不代表视觉、工具、推理、缓存和参考图字段都已被真实网关接受。会话持久化和摘要压缩也不等于跨会话长期记忆。

OpenCode 的配置也有代际差异：V2 使用 `permissions`、`shell`、`subagent`，V1 使用 `permission`、`bash`、`task`，外部目录默认策略和保存审批的范围也不同。不能把 V1 教程直接当作 V2 配置使用。[O3][O11]

## 5. 值得借鉴的具体机制

### 5.1 OpenCode

**统一服务状态，而不是立即重写框架。** 现有 Mingshen GUI、Quick Chat、Headless、ACP 已可作为起点。先统一运行 ID、事件序号、审批、幂等提交和取消回执，再补 CLI/IDE 客户端契约；这样可减少各入口状态不一致。远程控制最后再做，避免把回环接口直接暴露到网络。[O12]

**为已有后台子会话补全生命周期。** Mingshen 已有异步派发和跟进，不需要重复新增。可进一步强化“子任务 + 独立 Worktree + 任务所有权 + 交接结果”的关联、重启后状态对账和并行写冲突提示；不要为了数量突破现有并发及无递归约束。[O6][O7]

**参考 Code Mode 的工具聚合，保留执行边界。** Mingshen 已有批处理/执行链和大输出恢复，应先评测工具表大小、轮次与失败率，再决定是否引入受限脚本编排。若引入，要有独立调用预算、取消、权限逐项检查和可恢复输出；不能把任意宿主 JavaScript 执行器等同于优化。[O5][O10]

**将组织硬限制与单次审批分开。** 在现有 Profile 上增加不可被项目覆盖的 provider/tool/MCP/Skill/plugin 策略，适合后续团队部署。审批通过不应放开管理员拒绝，企业配置也不应由模型自行修改。[O11]

### 5.2 DeepSeek Harness

**先统一工具结果契约。** 在现有 `ToolExecutionResult` 上引入按工具验证的结果 envelope，明确成功、部分成功、失败、未验证、停止未确认；包含产物、来源、资源用量与验证证据。优先覆盖 Office、插件/MCP、后台命令，避免模型只从“成功”文本推断真实结果。[D7]

**扩展现有协作状态，而不是重建第二套总控。** Mingshen 已有计划依赖、角色、QA 和事件流。可以借鉴 Agent Teams 的 revision CAS、任务认领与共享状态，处理两个 Agent 同时修改同一计划、过期写入、重复交接和重启后的任务归属。是否开放分布式团队执行应另行评估。[D5]

**把定时任务提升为可解释的投递系统。** 在当前间隔任务上加一次性、时区、cron/RRULE、忙碌时策略、错过时点策略、投递回执与业务完成状态。DSH 的调度是至少一次投递，收件箱回执不等于模型完成；`new` 目标没有公开的 Schedule 级并发上限，但仍受宿主与服务资源约束。Mingshen 应主动设置并发和费用预算。[D10]

**办公底座支持降级，并让检查结果可见。** 借鉴 Office Kit 的原生/WASM 渲染与重算分层，评估在无 Microsoft Office 的机器上增加可选后端。必须比较字体、复杂公式、图表、中文分页与源文件保真；不能因为转出了 PDF 就宣布排版或计算通过，也不应自动安装 Office/LibreOffice。[D4]

## 6. 推荐顺序与验收标准

以下为调研建议，本轮没有实装这些新功能。

| 优先级 | 建议 | 最小可验证结果 |
| --- | --- | --- |
| P0：下一轮先做 | 模型首包/流空闲 watchdog，明确与用户停止、总运行时间、重试次数的关系 | 对“连接不结束但永无数据”“一直有心跳但无内容”“取消与超时同时发生”本地 fixture 验证，任务可结束且不执行半截工具；不能重新引入子 Agent 固定总时限 |
| P0：发布核对 | 统一 LICENSE/包元数据/文档；处理三项依赖公告；完成真实安装/升级/卸载检查 | 声明一致、逐项公告适用性/升级回归有记录，旧 profile 升级和卸载数据策略实际验证；需要发包时再生成含当前修复的包 |
| P1 | 运行 journal、恢复对账和事件续接 | 重启后每个工具有完成/未开始/不确定分类；不确定写入先核实，不直接重放；事件按游标续接与去重 |
| P1 | Office 质量闭环 | 选取财报、项目汇报、教案、复杂旧稿等固定任务；验证公式/结构并渲染逐页检查，返回未验证项和真实产物 |
| P1 | 工具输出 Schema 与插件契约测试 | 对异常输出、部分结果、取消、超时、更新失败都给结构化状态，旧插件兼容性有 fixture |
| P1 | 强化协作与 Worktree 所有权 | 共享计划使用 revision；并行写冲突可见；QA 必须附证据，未运行不能显示通过 |
| P2 | 调度规则与投递状态 | 时区/DST、忙碌队列、过期补投、至少一次去重和重启持久化可测试 |
| P2 | CLI/ACP/IDE 契约与组织策略 | 共用同一会话/审批/事件；组织 deny 不可被项目覆盖；接口有版本和兼容测试 |
| P3 | 远程/移动与更大插件生态 | 先完成认证、配对、审计和供应链设计，再扩展入口；没有这些证据前不宣传企业就绪 |

## 7. 如何真正比较“能力强弱”

建议下一轮建立固定同题评测，分别测代码与办公，不给三款产品套一个主观总分。

| 任务组 | 固定输入 | 验收指标 |
| --- | --- | --- |
| 代码修复 | 相同仓库、commit、缺陷与隐藏测试 | 首次通过率、最终通过率、无关改动、真实耗时、人工干预次数 |
| 跨模块开发 | 同一需求、验收脚本与可用工具 | 依赖处理、接口一致性、测试/构建、回归数与变更可审阅性 |
| 长任务与不稳网络 | 同一本地模型响应夹具和断流/挂起序列 | 完成工具保留、未完成调用阻断、重试预算、恢复后重复副作用、取消清理 |
| Excel | 相同数据、公式、打印要求与基准答案 | 结构、公式值、重算状态、图表、分页及外部引用策略 |
| Word/PPT | 相同资料、受众、品牌规范、页数和旧稿 | 内容完整、可编辑性、字体、溢出/重叠、对齐、图表、跨页连贯性；盲评审美 |
| 扩展与治理 | 相同插件/MCP 合成故障与权限规则 | 安装/更新回滚、输出校验、审批、拒绝、取消、可追溯事件 |

固定模型与版本、采样参数、上下文/输出预算、网络条件、工作区初始状态、允许工具和人工提示。记录实际模型请求与 usage；主任务、子任务、记忆、压缩和重试用量分别统计。缓存用冷/热两组，遵守供应商真实计费，不把本地“已配置缓存”当作命中。每个任务重复运行并保存产物；框架不支持同一模型/接口时应单列，不强行比较。

## 8. 来源与本地证据

外部链接均于 2026-11-26 访问。关键源码固定到 tag 或 commit；默认在线文档会继续变化。GitHub 匿名 API 部分请求达到限额，版本采用具体 tag、官方页面、npm 和官方更新 feed 交叉核对，没有要求用户提供凭据。未使用星标数、下载量或宣传的模型/技能数量推断性能。

### OpenCode 官方资料

- [O1]：OpenCode V2 `2.4.2` [Release](https://github.com/anomalyco/opencode/releases/tag/v2.4.2)、[Changelog](https://opencode.ai/changelog/v2.4.2)、[npm 元数据](https://registry.npmjs.org/@opencode%2Fcli/latest)。
- [O2]：[官方身份与 MIT](https://opencode.ai/press)、[根 LICENSE](https://github.com/anomalyco/opencode/blob/v2.4.2/LICENSE)。
- [O3]：[当前 V2 文档](https://opencode.ai/docs/)、[V1 文档](https://opencode.ai/v1/docs/)、[已归档同名项目](https://github.com/opencode-ai/opencode)。
- [O4]：[Desktop](https://opencode.ai/desktop)、[Mobile](https://opencode.ai/mobile)。移动端是连接用户电脑上的会话，不代表手机独立执行。
- [O5]：[Tools / Execute](https://opencode.ai/docs/tools#execute)、[构建插件](https://opencode.ai/docs/build/plugins)。
- [O6]：[Agents](https://opencode.ai/docs/agents)、[Subagent](https://opencode.ai/docs/tools#subagent)。
- [O7]：[Worktree 工具](https://opencode.ai/docs/tools#worktrees)、[配置](https://opencode.ai/docs/config#worktrees)。
- [O8]：[Snapshots](https://opencode.ai/docs/snapshots)、[V2 重启续跑源码](https://github.com/anomalyco/opencode/blob/v2.4.2/packages/core/src/session/execution/restart.ts)。
- [O9]：[Models](https://opencode.ai/docs/models/)、[Providers](https://opencode.ai/docs/providers/)、[Compaction](https://opencode.ai/docs/compaction/)、[Warming](https://opencode.ai/docs/warming/)。
- [O10]：[Plugins](https://opencode.ai/docs/plugins)、[Skills](https://opencode.ai/docs/skills)、[MCP](https://opencode.ai/docs/mcp-servers)、[Hook](https://opencode.ai/docs/build/plugins/server#hooks)。
- [O11]：[Permissions](https://opencode.ai/docs/permissions)、[Policies](https://opencode.ai/docs/policies)、[SECURITY.md](https://github.com/anomalyco/opencode/blob/v2.4.2/SECURITY.md)。
- [O12]：[CLI](https://opencode.ai/docs/cli/commands)、[Web](https://opencode.ai/docs/cli/web)、[ACP](https://opencode.ai/docs/cli/acp)、[SDK](https://opencode.ai/docs/build/sdk)、[API](https://opencode.ai/docs/api)。
- [O13]：[当前服务密码生成](https://github.com/anomalyco/opencode/blob/v2.4.2/packages/cli/src/server-process.ts#L85-L97)、[认证中间件](https://github.com/anomalyco/opencode/blob/v2.4.2/packages/server/src/middleware/authorization.ts#L76-L111)。

认证证据的版本冲突：OpenCode `SECURITY.md` 仍描述旧的“未设密码时无认证”模式；V2.4.2 CLI 源码与现行 Web 文档显示，官方 CLI/service/Web 路径会使用配置或随机生成的密码，默认监听 localhost。当前变量优先使用 `OPENCODE_PASSWORD`，并兼容旧名 `OPENCODE_SERVER_PASSWORD`。直接嵌入 server 时仍可传入无密码配置，不能把官方 CLI 默认值外推到所有部署；本轮没有实际启动验证。审批不等于沙箱的官方声明仍应保留。[O11][O13]

### DeepSeek Harness 官方资料

- [D1]：[官方产品页](https://www.deepseek.com/harness/)、[官方仓库 README](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/README.md)。README 明确开发者预览及破坏性变更。
- [D2]：[npm](https://www.npmjs.com/package/@deepseek-ai/dsh)、[Windows 稳定 feed](https://download.deepseek.com/dsh-desk/feeds/win-x64/stable.yml)、[macOS 稳定 feed](https://download.deepseek.com/dsh-desk/feeds/mac-arm64/stable-mac.yml)。
- [D3]：[固定源码 commit](https://github.com/deepseek-ai/deepseek-harness/commit/4b399c39a6d1479cd84ca591b4d7c88e24d38a96)、[桌面包版本](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/apps/desktop/package.json)。
- [D4]：[Office Kit](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/subsystems/office-kit.zh.md)。
- [D5]：[Agent Teams](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/subsystems/agent-team.zh.md)。
- [D6]：[Subagent](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/subsystems/subagent.zh.md)。
- [D7]：[工具流水线](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/subsystems/tools.zh.md)。
- [D8]：[会话持久化](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/subsystems/persistence.zh.md)。
- [D9]：[插件管理器](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/boot/plugin-manager/README.zh.md)、[插件索引](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/user/guide/plugin-market.zh.md)。
- [D10]：[Schedule 指南](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/user/guide/schedule.zh.md)、[机制与限制](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/schedule/schedule/README.zh.md)。Host 必须运行；不是带系统唤醒、自动重试和执行 SLA 的后台平台。
- [D11]：[审批](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/subsystems/approval.zh.md)、[沙箱](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/subsystems/sandbox.zh.md)。
- [D12]：[MIT LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/LICENSE)、[官方服务条款](https://www.deepseek.com/harness/terms-of-use/)。Profile 插件在 Host 进程内运行，不因安装而获得工作区沙箱隔离。
- [D13]：[上下文压缩](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/subsystems/compaction.zh.md)、[压缩实现](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/compaction/compaction-basic/README.zh.md)、[缓存 TokenUsage](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/subsystems/llm-streaming.zh.md)、[LLM 服务限制](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/llm/llm/README.zh.md)。
- [D14]：[第三方 Memory MCP 接入](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/user/guide/mcp-memory.zh.md)。参考配置不等于安装或运营 Memory Server。

### Mingshen 本地证据

- [M1]：[模型请求与固定重试预算](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/providers/model-stream.ts:2073)、[模型重试运行回归](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/chat/model-retry-runtime.test.ts:200)。
- [M2]：[根 MIT 文本](/C:/Users/ASUS/Desktop/MingshenHarness/LICENSE:1)、[根包元数据](/C:/Users/ASUS/Desktop/MingshenHarness/package.json:9)、[桌面包元数据](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/package.json:9)。
- [M3]：[模式权限](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/chat/agent-mode-policy.ts:7)、[用户手册](/C:/Users/ASUS/Desktop/MingshenHarness/docs/USER_GUIDE.md)。
- [M4]：[Office 工具](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/documents/office-document.ts:1173)、[模板场景回归](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/shared/creative-templates.test.ts:32)。
- [M5]：[生图服务](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/image-studio/image-studio-service.ts:1619)、[远程下载](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/providers/image-result-download.ts:145)、[桌面体验说明](/C:/Users/ASUS/Desktop/MingshenHarness/README.md:65)。
- [M6]：[子任务运行](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/chat/chat-service.ts:7378)、[协同状态](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/chat/coordination-service.ts:81)、[跨会话计划库](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/chat/session-workbench-service.ts:217)。
- [M7]：[启动中断恢复](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/storage/repository.ts:291)、[恢复会话入口](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/chat/chat-service.ts:1929)。
- [M8]：[工具结果类型](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/tools/tool-registry.ts:86)、[安全模型](/C:/Users/ASUS/Desktop/MingshenHarness/SECURITY.md)。
- [M9]：[扩展安装生命周期](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/extensions/extension-service.ts:826)、[本地插件接口](/C:/Users/ASUS/Desktop/MingshenHarness/docs/LOCAL_PLUGINS.md)。
- [M10]：[定时服务](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/schedules/scheduled-task-service.ts:5)、[触发时间持久化](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/storage/repository.ts:1453)。
- [M11]：[回环 API](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/server/headless-server-service.ts:110)、[SDK](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/resources/sdk/README.md)。
- [M12]：[项目记忆](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/agents/project-memory-service.ts:116)、[TencentDB 本地核心](/C:/Users/ASUS/Desktop/MingshenHarness/apps/desktop/src/main/agents/tencent-memory-service.ts:166)、[用户手册中的记忆与压缩](/C:/Users/ASUS/Desktop/MingshenHarness/docs/USER_GUIDE.md)、[供应商缓存](/C:/Users/ASUS/Desktop/MingshenHarness/docs/PROVIDER_CACHING.md)。
- [V]：[1.3.7 验证记录](/C:/Users/ASUS/Desktop/MingshenHarness/docs/VALIDATION_1.3.7.md)、[完整测试 JSON](/C:/Users/ASUS/Desktop/MingshenHarness/.impeccable/review/v137-retry-full-vitest-20261126.json)。

本地链接针对本次工作区快照，后续编辑可能改变行号；自动化 JSON 和截图位于被忽略的 `.impeccable/review/`，不是公开发布材料。对外分享前应移除私人路径并另行准备可复现的脱敏证据。
