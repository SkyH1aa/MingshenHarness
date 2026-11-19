# T3 Code 研究与 1.3.3 FIFO 自动队列

最后核对：2026-11-19（Asia/Shanghai）。

本文记录 Mingshen Harness 1.3.3 对 T3 Code 会话输入的研究与窄范围实现。参照源码固定为
commit `3babab1497ddd82dfd90a0d53ad4d16ebae41063`，项目采用 MIT License，
Copyright (c) 2026 T3 Tools Inc.

本文是产品交互研究和 Mingshen 自己的实现记录，不是对 T3 Code 源码的逐字复制，
也不表示 Mingshen 已兼容其远端控制面、供应商 runtime 或编排协议。

## 研究结论

T3 Code 把“Agent 运行中继续输入”分成多种动作，其中 Queue 的语义是：

- 当前 run 继续执行，新的文本和附件进入后续队列，不会插入或改写正在进行的模型轮次。
- Queue 项先持久保存，可编辑、删除和排序。
- 当前 run 完成后，队列项在新的 run 中按顺序发送。
- 用户 Stop 或 server 重启后，队列保留原顺序并进入 Hold；恢复必须显式操作，
  不会因为状态变化自动继续。
- T3 还提供 Steer、interrupt/restart、provider-native continuation 等交互，
  但这些不属于 Mingshen 本轮 Queue MVP。

T3 把正常完成后的队列推进与 Stop、server 重启后的显式恢复分开。Mingshen 采用同一
类安全边界，但对正常成功完成允许自动推进：Stop、失败、自动发送失败或重启进入可见的
暂停原因；显式恢复或同一会话后续一轮正常运行成功后，从首项接续。审批和配置变化不会
让队列越队。

## 1.3.3 接入边界

当前接入采用以下 FIFO 自动派发边界：

- 主界面的 CodeAgent、WorkAgent 与 ChatAgent 主会话运行中，用户可把文字与已验证附件加入“下一轮队列”。
- 队列保存在本地应用数据中，不依赖当前 renderer 存活。
- 当前任务正常完成且后台清理结束后，自动发送最早加入的一项；审批等待期间不推进队列。
- 支持编辑文字、替换附件和删除，严格按首次加入顺序发送，不提供排序或插队。
- 编辑开始时暂停整个队列；编辑期间若任务被停止或失败，保存或取消只结束编辑，队列仍暂停。
- 附件替换失败时保留原附件快照并暂停，避免自动发送未经确认的旧内容。
- 停止、运行失败、自动发送失败或应用重启会保留并暂停队列；可显式恢复，也可由同一会话后续一轮正常运行成功后自动接续。
- 会话忙碌、已归档、配置快照已变化或上一项派发未确认时阻断队列并说明原因，不会跳过首项。
- 队列拥有明确的条目、附件和配置快照上限，并且 fork 不继承、删除会话时清理。
- Quick Chat 与实际 SubAgent 不显示队列，服务层对入队和继续再次校验宿主关系并拒绝绕过 IPC 的请求。主界面 ChatAgent 支持 Queue，但其本地文件、命令、Skills、MCP 和子 Agent 工具边界不受 Queue 影响。

本轮不实现：

- 将新输入插入正在进行的 provider turn 的 Steer。
- 为 Steer 中断并重启当前 run。
- T3 的远端 server control plane、provider thread/runtime 恢复协议或事件投影。
- T3 的 worktree、子任务和跨环境 orchestration。
- Stop 后未经用户恢复就自动重跑，或把失败、重启后的队列当作可安全重放。
- 对 T3 私有 API、数据格式或 UI 的兼容声明。

这些排除项是权限、数据恢复和副作用保护边界，不是能力高低的判断。

## Mingshen 本地语义

实现位于 `apps/desktop/src/main/chat/queued-prompt-service.ts`、
`apps/desktop/src/shared/queued-prompt.ts`、
`apps/desktop/src/renderer/src/components/QueuedPromptTray.tsx` 及对应 IPC/UI 接线。

- 存储键为 `app_settings/chat.queue.<sessionId>`，沿用现有 schema 9，不新增迁移。
- 只有会话正在执行时才入队；空闲发送保持原有发送路径。
- 文本与验证后的附件快照持久化；列表只返回附件元数据，自动派发时持久化字节交由现有 `ChatService` 按上传规则重新验证和处理。
- 配置快照覆盖 mode、workspace、profile、provider、model、permission、approval 与 execution mode。
  这些关键项变化后，旧队列不能静默以新配置发送。
- 正常完成在后台清理结束后自动推进首项；approval wait 不推进，Stop、失败、自动发送失败和重启进入 Hold。
- 队列级 Resume 或同一会话后续一轮正常运行成功可从首项接续，不提供逐项 Continue 或重排；编辑或附件替换失败后保持暂停。条目支持编辑、附件替换和删除，发送成功后出队，失败保留供修正。
- 队列不复制到 fork，删除会话时同步清理。
- Queue 属于主界面的 CodeAgent、WorkAgent 与 ChatAgent 会话。Quick Chat 与实际 SubAgent 的入队和继续由渲染层及主进程双重拒绝；Queue 不扩大任何工具、Skills、MCP、审批或隔离权限。

源码已实装上述窄接入。定向测试、完整自动化、真实 Electron 交互和发布构建仍需以
[1.3.3 验证记录](VALIDATION_1.3.3.md)中最终完成的条目为准。本文不提前写入尚未执行的
验证数字，也不把 service-only 单元测试等同于 renderer、IPC 和真实 provider 已验收。

## T3 参考位置

- [Composer and queued messages](https://github.com/pingdotgg/t3code/blob/3babab1497ddd82dfd90a0d53ad4d16ebae41063/docs/user/composer.md)
- [Orchestration v2 feature lifecycles](https://github.com/pingdotgg/t3code/blob/3babab1497ddd82dfd90a0d53ad4d16ebae41063/docs/orchestration-v2/feature-lifecycles.md)
- [Orchestration v2 contracts](https://github.com/pingdotgg/t3code/blob/3babab1497ddd82dfd90a0d53ad4d16ebae41063/packages/contracts/src/orchestrationV2.ts)
- [Settings contracts](https://github.com/pingdotgg/t3code/blob/3babab1497ddd82dfd90a0d53ad4d16ebae41063/packages/contracts/src/settings.ts)
- [Composer dispatch](https://github.com/pingdotgg/t3code/blob/3babab1497ddd82dfd90a0d53ad4d16ebae41063/packages/client-runtime/src/state/composerDispatch.ts)
- [MIT License](https://github.com/pingdotgg/t3code/blob/3babab1497ddd82dfd90a0d53ad4d16ebae41063/LICENSE)

其中，Composer 文档第 246-273 行描述 held queue、编辑/删除与显式 Resume；
feature lifecycle 文档第 63-101 行和第 229-254 行明确 Queue 会创建 active run 之后的
新 run，并记录 Stop 不自动重启；contracts 第 729-742 行和第 3463-3510 行包含
`queue_after_active`、`queue.resume`、`queued-run.start/reorder/cancel/edit`、
`queuePosition` 和 `run.interrupt`；client runtime 在 active turn 不可 Steer 时选择 Queue。

## 后续候选

1. **可恢复的供应商会话交接**：保留 provider-native thread/cursor，在崩溃、重启或
   模型配置变化后显式恢复或重建上下文。风险高于 Queue，涉及各协议的原生状态。
2. **结构化计划与执行图**：为 run、工具节点、检查点、依赖和子任务建立可恢复投影。
   可与现有计划、子 Agent 和轨迹结合，但需要新的持久化合同。
3. **worktree 与跨环境编排**：把隔离目录、任务树和远端执行统一为可审计的控制面。
   当前不是 1.3.3 的发布阻塞项，也不应复制 T3 的私有产品结构。

本轮选择 Queue，因为它直接改善运行中继续输入，同时可以沿用现有会话、草稿、附件、
审批和数据库结构；其他候选仍保留为研究，不以源码参照名义宣称已实现。
