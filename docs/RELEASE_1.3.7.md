# Mingshen Harness 1.3.7

> 1.3.7 的源码和随包文档已同步并发生图、默认浏览器打开入口、运行日志与交互修复及对应安全边界。本文在正式打包前冻结；新增改动的 focused、native、full、类型检查、Lint、生产构建、资源预检和隔离 Electron 桌面结果以当前[验证记录](VALIDATION_1.3.7.md)为准，不沿用改动前的历史计数。Windows 安装包及 ZIP 的最终交付核验记录见根目录 `AGENT.md` 最新 1.3.7 交付节，精确 SHA-256 和大小见产物旁的 `.sha256` / `.json`。安装、升级、卸载和线上发布不在本页的通过声明中。

## 中文发布草案

**标题：Mingshen Harness 1.3.7：生图增强与运行治理**

**简介：**

本次更新围绕生图体验、长任务可靠性与本地诊断，完善日常工作中的关键流程。

- **生图工作台**：支持独立 OpenAI Images 协议、最多 3 个并发请求、每项 600 秒等待预算。远程图片可先预览并确认保存，也可在系统默认浏览器打开。
- **统一运行与恢复**：支持幂等发送、事件续接、准确停止和人工恢复；模型请求中断后不自动重放已完成的工具操作。
- **管理与办公交付**：增加应用和机器管理策略、工具结果校验、计划步骤认领，以及绑定文件哈希的 Office/PDF 交付检查回执。
- **开发者接口**：完善本地 `/v1` API、SDK、CLI 与 ACP 接入，支持运行查询、事件续接、计划认领和受控办公回执操作。
- **体验与诊断**：新增全局一键已读，修复生图画布的滚轮警告；运行日志扩展接口故障统计，最多保留 30 天 / 15 MiB，可由用户主动导出。

升级前建议关闭应用并备份数据目录。升级后数据库为 schema 11；如需回退到旧版，请使用升级前的完整备份。日志保存在本机，导出前请检查可能包含的敏感信息。

已安装 1.3.7 的用户需手动运行本次新版安装器；应用不会因同版本重新打包而触发自动更新。

### 更新详情

1.3.7 为日常会话、供应商配置、长任务运行治理和生图工作台补齐直接影响使用体验的闭环。

顶栏新增“一键已读”。点击后立即执行，无需额外确认，一次清除 CodeAgent、WorkAgent 和 ChatAgent 中所有已完成但尚未查看的会话标记，Windows 任务栏应用图标的未读数字同步归零。该操作只处理完成提醒，不会替你回答审批或问题，不停止正在运行的任务，不删除会话，也不会把失败或已停止任务改写为完成。未读状态继续按会话去重并保存在本机。

供应商配置新增独立 `OpenAI Images` 协议。用户可以明确建立一个 `OpenAI /v1/images` 连接，不再需要把图片模型挂在 Chat Completions 或 Responses 文本协议下。通过手动添加、编辑或模型列表导入的该协议模型默认并强制为纯图片输出；即使 IPC、脚本、Headless 或旧客户端省略输出模态，后端也会默认使用图片，显式文字/混合输出和工具调用仍会拒绝。界面隐藏上下文、工具、思考等级和提示缓存等不适用字段；该供应商也不会出现在聊天、审批、压缩、润色或图片反推提示词的语言模型选择中。该协议拒绝缓存配置，从文本协议切换进来时会清除旧缓存设置。Base URL 必须填写到 `/v1`，完整 `/images/generations` 或 `/images/edits` 端点会被明确拒绝而不是自动改写。既有 Responses / Chat Completions 图片配置继续兼容；新的生图配置应优先使用专用协议。当前实现覆盖标准同步图片生成与参考图编辑，不启用第三方私有的异步任务轮询。

生图工作台现在兼容供应商返回 Base64 图片、远程图片 URL，或在同一次响应中混合返回两种结果。Base64 结果继续按既有格式、大小、像素和数量预算直接保存。URL 结果不再因“不是 Base64”而整批失败，也不会直接写入素材库。为显示应用内预览，主进程先以不携带模型 API Key、Cookie 或浏览器凭据的请求，将远程图片载入有限内存并校验；此时尚未写入素材库。预览显示来源和本次生成提示词，只有用户确认后才把已验证候选保存为本地素材。关闭预览或选择“稍后”不会立即丢弃候选，仍可在约 30 分钟内从待确认入口重新打开；候选到期、被明确丢弃或应用退出等情况下才结束可用期。

URL 预览与确认保存由主进程完成，不向图片地址发送模型 API Key、Cookie、浏览器凭据或其他供应商鉴权。地址必须是无凭据的公开 HTTPS，并拒绝私网、回环、本机、保留地址、不安全重定向和 DNS 重绑定目标。每张图最多 25 MiB，单次结果合计最多 100 MiB，每次下载最多 90 秒；这些是 URL 生图预算，手动导入、拖放和批量导出/ZIP 的既有 500 MiB 预算另行适用。返回内容必须通过 PNG、JPEG、WebP 或 GIF 的完整格式与像素校验。确认保存的图片与普通生成素材使用同一套本地素材记录，并保留本次请求的正面提示词、负面提示词和供应商修订提示词，可继续加入画布、下载、批量导出、删除和提示词回导。成功解码和公开网络校验不代表图片内容安全、授权或版权合规。

预览弹窗新增“在浏览器打开”，在加载中、加载失败和预览已就绪时都可用。Renderer 只向主进程提交不透明候选 ID 和请求 ID；主进程重新核对候选、期限、字面网络目标和 `browser.use` 策略，并对域名执行最多 5 秒的 A/AAAA 全量解析，要求每个结果均为公网地址。解析完成后、交棒前还会再次核对候选期限、operational、`network.request` 与 `browser.use`，之后才打开系统默认浏览器。该入口不等待预览下载队列，不取消或改变下载，也不改变素材保存状态。外部浏览器是独立会话，登录、Cookie 和验证码不会回传 Mingshen Harness，后续 DNS、重定向和页面导航也不受应用内受控图片下载器的同一约束。用户可在浏览器完成需要独立会话的人机检查，但在浏览器打开图片不等于应用内远程下载已经通过安全校验；保存到素材库仍须经过 Mingshen Harness 的受控预览和确认。

同批结果中，已经验证通过的 Base64 图片可以正常保存，不会因为 URL 候选仍待确认而丢失。若用户确认保存多个 URL 候选或部分候选失败，界面会明确标记成功和失败项，不把尚未确认或尚未保存的地址冒充本地文件。

生图工作台和主进程分别限制最多 3 个并发生成请求。每项有独立状态和取消入口，用户可以继续发起其他请求，也可切换到 ChatAgent、Workstation 等页面并让请求继续后台执行。每个 generation 的总预算为 600 秒，包含供应商请求、响应解析和结果提交；远程 URL 预览下载仍单独限制 90 秒，文本润色、反推提示词、网页请求和其他旧流程的预算不受此次调整影响。提交时快照正面/负面提示词、参考图和目标画布；结果返回时保留用户之后编辑的提示词和当前活动画布，不会把界面退回旧状态。如果目标画布已关闭或删除，结果保留在素材库，不会自动重新创建或复活该画布。

1.3.7 同时补齐长任务运行治理。请求在附件处理、命令预处理和模型调用前先持久接纳并分配 `runId`；相同幂等键和载荷返回原运行，停止只作用于准确运行。事件可通过快照、游标和 SSE `Last-Event-ID` 续接，Token 增量不写入数据库，最终消息与工具结果仍是权威内容。崩溃重启会恢复运行和事件记录，把未结束执行标为中断；用户继续前必须核实可能副作用，不会自动重放模型请求、命令或已完成工具。首个模型响应默认最多等待 5 分钟、流空闲最多 15 分钟，有效正文、思考或工具参数才会推进空闲计时；这是单次请求等待检测，不是 SubAgent 或任务的总运行时间。

管理策略新增应用级限制与 `%ProgramData%\MingshenHarness\managed-policy.json` 机器策略。内置安全边界、机器策略、应用限制、模式、项目和执行环境叠加后拒绝优先，项目文件、Agent 提示词和完全访问不能放宽。机器策略存在但损坏、不可读或版本不支持时，新模型、工具和扩展执行暂停，历史查看、诊断、停止与清理仍可用。工具结果新增 `ToolOutcome`，把执行、副作用确定性、结构校验、业务验收、证据和大输出恢复引用分开；结构验证失败不会被记成成功，可能已有写副作用时保留屏障并要求先核实。

办公交付也不再只靠文件写入成功判断。主 CodeAgent/WorkAgent 在宿主、完全访问且有工作区时，工具批次后产生或修改的 DOCX、XLSX、PPTX、PDF 会自动生成绑定最终文件 SHA-256 的回执，检查包、结构、内容、公式、重算、渲染和视觉状态。可修复问题回到当前模型，按每个文件最多 3 轮受控修复；文件变化后旧回执失效，预算耗尽后当前运行对该文件的后续写入被阻止。缺少 Office、LibreOffice、视觉模型或页面预算时明确降级为未验证或部分覆盖，不会把“已写入”显示成“已通过”。

运行日志补充桌面 IPC、本地 API 和后台工具、插件 Hook、办公检查的失败或警告诊断，设置与导出显示当前留存记录的错误、警告、来源、操作和已知省略/损坏数量。本地日志最多保留 30 天、五个文件合计最多 15 MiB；统计是记录数，不等同去重后的故障数或永久历史。新增后台诊断主要记录有界状态和代码，不主动记录工具输出或文档正文。SDK、CLI 和 ACP 只有抵达宿主的调用及宿主事件能进入桌面日志，客户端离线或本地参数错误需要查看客户端输出。日志不会自动上传，分享导出文件前仍需检查敏感信息。生图画布的滚轮监听已修复，Electron 控制台接口同步更新，避免重复警告和同一 IPC 错误的重复控制台记录。被画布引用的素材仍受删除保护。

SQLite schema 升至 11，新增持久运行、请求接纳、可续接事件、计划认领和办公交付回执记录，并继续包含 schema 1–10 的历史步骤。已有供应商、Key、模型、会话、设置、同意记录和凭据密文不因升级而清空。schema 10 升级前会创建 `.pre-v11-backup-<时间>-<随机值>.sqlite` 完整备份；迁移失败时主库保留在 schema 10。旧 schema 10 程序不能打开已升级到 schema 11 的数据库；需要回退应用版本时，应先关闭应用并恢复升级前完整备份或数据目录，不能直接让旧程序覆盖或降级数据库。

本轮最终完整回归为 231 个文件中 228 个通过、3 个环境跳过，3,175 项通过、15 项环境跳过、0 失败；真实 Electron 专项 20 组通过，包含画布滚轮、日志导出、失败统计和中英文紧凑布局。类型检查、Lint、生产构建、根 Node 脚本 163/163 及 13,877 项资源预检均通过。本文与其他随包文档在正式打包前冻结；正式产物的 EXE 版本、ZIP 根条目、大小、SHA-256、缓存副本和随包资源独立核验结果只记录到根 `AGENT.md` 最新交付节与旁置元数据。生产依赖审计仍有 3 项中等严重性公告；安装、升级和卸载须单独验收。

实际证据与未覆盖范围见 [1.3.7 验证记录](VALIDATION_1.3.7.md)。

## English Draft

**Mingshen Harness 1.3.7: Global Read State, Concurrent Generation and Confirmed Remote Images**

Mingshen Harness 1.3.7 closes practical loops across everyday conversations, provider configuration, long-task runtime governance and Image Studio.

Users already on 1.3.7 must run the rebuilt installer manually; repackaging the same version does not trigger an automatic update.

The titlebar now provides **Mark all as read**. Clicking it acts immediately with no additional confirmation: completed-but-unviewed markers are cleared for every CodeAgent, WorkAgent and ChatAgent conversation, and the Windows taskbar unread count is reset. This affects completion notifications only. It does not answer approvals or questions, stop running tasks, delete conversations or reinterpret failed and stopped runs as completed. Unread state remains deduplicated per conversation and stored locally.

Provider configuration adds a dedicated **OpenAI Images** protocol. Users can create an `OpenAI /v1/images` connection instead of attaching image models to a Chat Completions or Responses text protocol. Models added, edited or imported from discovery under this protocol default to and remain locked as image-output-only; if IPC, scripts, Headless startup or an older client omits the output modality, the backend also defaults to image, while explicit text/mixed output and tool execution still fail closed. Context, tool, reasoning and prompt-cache fields are hidden as inapplicable. The provider is excluded from language-model selectors for chat, approvals, compaction, polishing and image-to-prompt refinement. Cache settings are rejected for this protocol, and switching a text provider into it removes the previous cache configuration. The Base URL must end in `/v1`; a full `/images/generations` or `/images/edits` endpoint is rejected rather than rewritten. Existing Responses / Chat Completions image configurations remain compatible, while new image setups should use the dedicated protocol. This implementation covers standard synchronous generation and reference-image edits and does not enable third-party private asynchronous task polling.

Image Studio now accepts Base64 images, remote image URLs or a mixture of both in one provider response. Base64 results continue through the existing format, size, pixel and count budgets and are saved directly when valid. URL results no longer fail the whole response merely because they are not Base64, and they are not written directly to the asset library. To present the in-app preview, the main process first loads remote images into bounded memory with a request that carries no model API key, Cookies or browser credentials and validates them; they are not yet persisted to the asset library. The preview shows the source and prompts used for that generation, and only explicit confirmation saves the validated candidate as a local asset. Closing the preview or choosing **Review later** does not immediately discard the candidate; it can be reopened from the pending entry for about 30 minutes. Expiry, an explicit discard or application exit ends its availability.

The main process previews and confirms URL image saves without sending a model API key, Cookie, browser credential or other provider authorization to the image location. Targets must be credential-free public HTTPS URLs; private, loopback, local, reserved, unsafe-redirect and DNS-rebinding destinations are rejected. Each image is capped at 25 MiB, each result at 100 MiB and each download at 90 seconds. These are remote-generation budgets; the existing 500 MiB budgets for manual import, drag-and-drop and batch export/ZIP remain separate. The returned bytes must pass full PNG, JPEG, WebP or GIF format and pixel validation. A confirmed image uses the ordinary generated-asset record and retains the positive prompt, negative prompt and provider-revised prompt from the original request, so canvas, download, batch export, deletion and prompt-restore flows continue to work. A successful network check and decode do not establish that the content is safe, licensed or copyright-compliant.

The preview now provides **Open in browser** while loading, after a load failure and when ready. The renderer sends only an opaque candidate ID and request ID to the main process. The main process rechecks the candidate, expiry, literal network target and `browser.use` policy, and for a hostname performs a bounded five-second all-A/AAAA lookup that must return only public addresses. After resolution it rechecks candidate expiry, operational state, `network.request` and `browser.use` immediately before invoking the system default browser. This action does not wait for the preview download queue, cancel or alter the download, or change save state. The external browser is an independent session: its sign-in state, Cookies and CAPTCHA results are not returned to Mingshen Harness, and its later DNS resolution, redirects and navigation are not governed by the same controlled image-download policy. A user may use that independent browser session for a human check, but opening the image there does not establish that the in-app download passed its safety checks; saving to the library still requires the controlled preview and confirmation flow in Mingshen Harness.

Validated Base64 images in a mixed response can be saved normally and are not discarded because URL candidates still await confirmation. If multiple URL candidates are confirmed for saving or some entries fail, the interface identifies successful and failed items instead of presenting an unconfirmed or not-yet-saved URL as a local file.

Image Studio and the main process each cap concurrent generation at three requests. Every request has independent status and cancellation, and users can start other requests or switch to ChatAgent, the Workstation or another page while generation continues in the background. Each generation has a 600-second total budget covering the provider request, response parsing and result submission. Remote URL preview downloads retain a separate 90-second limit, while text polishing, reverse prompting, web requests and other existing budgets remain unchanged. Submission snapshots positive and negative prompts, references and the target canvas. A returned result preserves prompt edits and the current active canvas made after submission, and a result does not recreate or revive a canvas that was closed or deleted in the meantime.

Version 1.3.7 also completes the runtime-governance path for long tasks. A request is admitted and assigned a `runId` before attachment processing, command preprocessing or model invocation; the same idempotency key and payload return the original run, and stopping targets only the exact run. Events reconnect through a session snapshot, cursor and SSE `Last-Event-ID`; token deltas are not persisted, while final messages and tool results remain authoritative. A crash marks unfinished execution as interrupted after preserving run and event records. Continuing requires checking possible side effects first and never replays a model request, command or completed tool automatically. The first valid model response waits five minutes by default and stream idle waits fifteen minutes; valid text, reasoning or tool arguments advance idle time, while heartbeats do not. These are per-request watchdogs, not a total run or SubAgent deadline.

Application restrictions now compose with a machine policy at `%ProgramData%\MingshenHarness\managed-policy.json`. Built-in security boundaries, machine policy, application limits, mode, project and execution constraints combine with deny precedence. Project files, Agent prompts and Full Access cannot loosen them. If a machine policy exists but is corrupt, unreadable or unsupported, new model, tool and extension execution is paused while history, diagnostics, stop and cleanup remain available. `ToolOutcome` separates execution, side-effect certainty, structural validation, business verification, evidence and retained-output recovery. Schema-validation failure cannot be recorded as success, and an uncertain write keeps its barrier until the actual state is inspected.

Office delivery is no longer inferred from a successful write. A main CodeAgent or WorkAgent running on the host with Full Access and a workspace automatically creates receipts bound to the final DOCX, XLSX, PPTX or PDF SHA-256 after a tool batch and checks package, structure, content, formula, recalculation, render and visual stages. Repairable findings return to the current model for at most three bounded repair rounds per file. Changing the file invalidates the previous receipt, and exhausting the budget blocks further host writes to that artifact in the current run. Missing Office, LibreOffice, a vision model or page budget remains unverified or partially covered rather than being promoted from “written” to “approved.”

Runtime logs add diagnostics for failed or warned desktop IPC, local API, background tool, plugin-hook and Office-check operations. Settings and export summarize retained errors, warnings, sources and operations, plus known omitted or damaged records. Local logs retain up to 30 days across five files totaling at most 15 MiB. Counts are records, not deduplicated incidents or all-time history. New background diagnostics use bounded state/code metadata rather than deliberately recording tool output or document content. SDK, CLI and ACP diagnostics enter desktop logs only for calls that reach the host or events produced there; inspect client output for offline or locally invalid requests. Nothing uploads automatically; inspect an export for sensitive information before sharing. The Image Studio wheel listener was fixed, and the Electron console interface was updated to avoid repeated warnings and duplicate console logging of an IPC failure. Assets referenced by a canvas remain protected from deletion.

SQLite moves to schema 11 with persisted runs, request admissions, replayable events, plan claims and Office-delivery receipts while retaining every historical schema 1–10 step. Existing providers, keys, models, conversations, settings, consent and encrypted credentials are preserved. A schema-10 upgrade first creates a complete `.pre-v11-backup-<timestamp>-<random>.sqlite` copy; migration failure leaves the primary database at schema 10. An older schema-10 application cannot open a database already upgraded to schema 11; to roll back the application, close it and restore the pre-upgrade backup or complete data directory first instead of allowing the older build to overwrite or downgrade the database.

The final full regression passed 3,175 tests with 15 environment skips and no failures across 228 passed and three skipped files. The real Electron run passed 20 scenarios, including canvas wheel handling, log export, failure statistics and compact Chinese/English layouts. Type checks, lint, the production build, all 163 root Node checks and the 13,877-resource preflight also passed. This document and the other bundled docs are frozen before formal packaging. Final EXE version, sole ZIP entry, size, SHA-256, cached copies and bundled-resource checks are recorded only in the root `AGENT.md` delivery section and artifact sidecars. Three moderate production-dependency advisories remain; installation, upgrade and uninstall require separate acceptance.

See the [1.3.7 validation record](VALIDATION_1.3.7.md) for actual evidence and remaining boundaries.
