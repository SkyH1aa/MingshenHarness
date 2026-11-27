# Mingshen Harness 1.3.7 验证记录

最后更新：2026-11-27。本轮在并发生图版本之后继续修复诊断覆盖、15 MiB 日志留存、画布滚轮和 Electron 控制台接线；**下方原有 3,131 项测试和 17 组生图专项均为本轮修改前基线**。本轮最终结果单列在下一节，不沿用旧数字。版本保持 1.3.7、schema 11。随包文档在正式打包前冻结；正式 NSIS/ZIP 的最终 SHA-256、大小、缓存副本和资源独立核验结果记录到不随包分发的根目录 `AGENT.md` 最新交付节及产物旁置元数据。安装、升级、卸载和真实付费供应商未验收。

本页只记录 1.3.7 的实际执行证据。历史 1.3.6 数字不能替代本轮结果；模拟供应商、临时 profile 和源码检查也不等于真实付费供应商、正式安装、升级或卸载验收。

## 2026-11-27 诊断覆盖与交互修复

现场导出日志混有多个历史版本，共 13,480 条；按 UTC 时间筛选 11 月 26 日以来的 1,188 条，其中 1,042 条为被动滚轮监听警告，3 条为旧 Electron 控制台接口警告。已确认并修复生图画布 React 被动滚轮监听反复报警、旧 Electron 控制台回调签名、IPC 拒绝被 Electron 控制台重复存储，以及部分 API/后台结构化失败没有记录的问题。画布引用中的素材保持删除保护；供应商内容拒绝、账号权限、无可用通道和上游 HTTP 502/503 不冒充已由本地代码消除。

实际注册的 258 个桌面 invoke 通道统一经过诊断边界，包含参数检查前的来源、会话范围和协议同意拒绝。旧 HTTP API 与 `/v1` 根据静态路由模板记录 4xx/5xx，按指定返回契约补记插件校验和办公检查失败；普通历史状态读取不重复记账。后台工具按运行与调用 ID 有界去重，插件 Hook、Office 检查和损坏的持久事件也有固定诊断。SDK、ACP、CLI 未抵达宿主的离线或本地参数错误不可能由未参与的桌面进程自动收集。

日志使用 5 个文件、每个最多 3 MiB，合计最多 15 MiB、最长 30 天。设置和导出提供当前留存记录的错误、警告、来源、操作以及已知遗漏/损坏数量，不是去重后的故障数或永久累计。新增边界诊断不读取请求/返回正文；原有第三方异常仍只作尽力脱敏，分享前需要检查。HTTP 错误响应正文的自由文本在日志副本中省略，保留状态和有界类型/原因码；用户界面的原错误不被改写。

本轮最终源码检查结果如下。定向、完整回归、原生专项和打包预检属于不同层级，不能相加为测试总数。

| 检查 | 本轮结果 | 证据与边界 |
| --- | --- | --- |
| 完整 Vitest | **231 文件：228 通过、3 环境跳过；3,175 项通过、15 跳过、0 失败** | session **15386**，退出 0，**421.32 秒**；单 worker、`--no-file-parallelism`，没有放宽既有断言或超时。本轮真实 LibreOffice 隔离渲染 **8276ms**，源文件未变 |
| Electron 桌面专项 | **20 组通过、20 截图、12 组几何、17 次本地请求；0 异常、0 服务错误** | session **10123** 退出 0，测试进程和临时目录已清理。保留原 17 组生图/已读检查，新增真实 Chromium wheel/Ctrl+wheel、IPC/API 失败导出及中英文日志统计布局 |
| 类型检查 | **通过** | `pnpm typecheck` 退出 0，墙钟 **4.6114 秒**；Node/Web 两套类型检查 |
| Lint | **通过** | 最后格式收口后 `pnpm lint` 检查 **578 文件**，Biome **1418ms**、墙钟 **3.2171 秒**，退出 0 |
| 生产构建 | **通过** | `pnpm build` 退出 0，墙钟 **3.8018 秒**；main **189**、renderer **2,375**、preload **3**；正式入口还会从冻结源码重建 |
| 根 Node 脚本 | **19 文件、163/163 通过，0 失败/跳过** | session **19625**，退出 0，总时长 **29,248.7814ms**；资源、打包、Windows 复制/锁定及图标脚本检查 |
| 诊断定向 | **通过，已包含在完整回归** | IPC 边界 **7/7**、日志存储 **14/14**、后台事件与运行服务 **38/38**；覆盖 258 个实际 invoke 注册、无末尾换行修复、写入失败遗漏、隐私和事件去重，不与 full 数字相加 |
| SDK / ACP / CLI 与专项语法 | **通过** | 随包 Node 脚本及 `scripts/v137-image-unread-smoke.mjs` 的 `node --check` 退出 0；不替代真实第三方客户端验收 |
| 差异空白与 Markdown 链接 | **通过** | `git -c core.safecrlf=false diff --check` 退出 0；64 份 Markdown 中 349 个本地链接、31 个绝对路径链接均无缺失。绝对路径为内部历史，不能当作安装后可移植链接 |
| 打包资源预检 | **通过** | 官方 `package-win.cmd --check` session **57310** 退出 0，核对 **13,877 项资源**、生产依赖闭包及版本 **1.3.7** |
| 生产依赖审计 | **未通过：3 moderate，0 high / critical** | `pnpm audit --prod --json` 退出 1，381 依赖（328 production、53 optional）；仍为 `exceljs > uuid@8.3.2` 与 BrowserDo 路径 `@hono/node-server@2.1.5`，依赖与锁文件未改 |
| 正式 NSIS / ZIP | **文档冻结后独立核验** | 用户已授权生成 EXE 和 ZIP；新包版本、根条目、SHA-256、字节数、旁置元数据、构建缓存与资源逐项核对结果仅写根 `AGENT.md` 最新交付节和发布 SQL，不回写随包文档 |

完整 Vitest 证据：`.impeccable/review/v137-diagnostics-final-vitest-20261127.json`，SHA-256 为 `01af8778087f198953409eef80312f4e6022708b6d47c5c49e1550627a093ae9`。文件统计采用控制台 **228 passed / 3 skipped / 231 total**，不能依据 JSON 的文件 `status` 把环境跳过写成通过。15 项环境跳过包括 Office COM 3 项、目录链接条件 2 项及未启用的 GitHub/技能市场/MCP、真实文档隔离、原生沙箱/命令和 Docker 集成；没有启用真实凭据。

真实 Electron 证据：`.impeccable/review/v137-image-unread-1795785536657/result.json`，SHA-256 为 `50599e34c0a55197afe3da36e48d4a59442b31fb69c81c630b29aa335c797cd4`；对应专项脚本 SHA-256 为 `63c842f50b790838ae29384f0cac8b35a9bb72cdaed6cba46b75d0c4b632474d`。真实 IPC 的缺失素材错误只记录一次，插件无效清单和 Headless 401/404 进入导出；导出容量为 15 MiB，统计与留存记录一致，未出现测试 Token、被动监听或旧控制台签名警告。中文/英文 1040×680 日志页无横向溢出。根任务人工查看最终 `diagnostics-zh-1040.png`、`diagnostics-en-1040.png` 和 `diagnostics-wheel-canvas.png`，其余截图只计自动化证据。

专项只使用独立临时 profile、项目和本地合成供应商；远程预览图片传输与默认浏览器打开仍采用受控夹具，不操作正常用户数据、真实 Key 或付费服务。真实 Office COM、付费视觉模型、完整三环境矩阵、Windows 安装/升级/卸载和所有外部客户端长时故障切换仍未验收。

日志写入失败造成的遗漏会先保存在进程内并显示于状态/导出，在下一次成功写入后持久化；如果进程在持久化前崩溃，尚在内存的遗漏计数可能丢失。保留容量淘汰与损坏计数不是永久累计。Electron safeStorage 同步 API 的非致命弃用提示仍属后续迁移边界，本轮未改凭据存储生命周期。

本轮检查命令：

```powershell
pnpm --filter @mingshen/desktop exec vitest run --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile.json=../../.impeccable/review/v137-diagnostics-final-vitest-20261127.json
pnpm typecheck
pnpm lint
pnpm build
node --test scripts/*.test.cjs scripts/*.test.mjs
node scripts/v137-image-unread-smoke.mjs
.\package-win.cmd --check
git -c core.safecrlf=false diff --check
```

## 历史基线：2026-11-27 治理与生图增量检查

以下各行保留诊断改动前的实际执行窗口。项目属于不同测试层级，计数不能相加；表中的“当前”仅指该历史冻结轮，不能作为上方诊断改动的最终证据。

| 检查 | 已执行结果 | 覆盖范围与边界 |
| --- | --- | --- |
| Runtime/Headless 窄修复 | **2 文件、30/30 通过** | Runtime 与 Headless 实际契约；live delta 无 `id` 且不推进 durable cursor、停止关闭 `/v1` SSE、清心跳和退订后可重启 Token |
| Runtime `/v1` smoke | **9/9 通过** | 运行接纳、快照、准确 `runId` 停止、事件游标、等待态旁路事件、临时增量与过滤游标终态；不是正式桌面、托盘、SDK、ACP 全矩阵 |
| ACP bridge smoke | **10/10 通过** | 只接受本 bridge 创建的会话；外部会话事件被过滤但全局持久游标仍前进；`run_failed` / `run_interrupted`、精确停止和有界取消。较早 **6/6** 是不同阶段结果，不是当前总量 |
| 原子接纳 / 幂等重复 | **52/52 通过** | `runtime.status` `accepted` 事件与运行行、接纳记录同事务写入；重复请求返回原运行且不新增接纳事件；不替代最终 full |
| 运行治理集成 | **6 文件、61/61 通过** | 管理策略、formatter/diagnostics、Shell、LSP、损坏策略下停止/清理等执行前重检 |
| Runtime + Headless 子集 | **22/22 通过** | 与上方集成项有重叠，不能相加；不覆盖全部桌面与快捷 Chat 外观 |
| 计划认领定向 | **3 文件、40/40 通过** | `task-claims-handler`、运行治理与 `plan-claim-service`；覆盖 live executor、stale/跨运行写入防护、真实父子授权，以及外部 `settle.expectedVersion` 必填、正安全整数校验和心跳后 `409` CAS。较早 39/39、6 文件 54/54 与 3 文件 28/28 是不同阶段快照，不能与本轮数字相加 |
| SDK/CLI 真实 loopback 集成 | **通过（专项）** | 临时脚本启动实际 `HeadlessServerService` + Runtime + 临时 SQLite，使用实际随包 SDK 并 spawn 实际 CLI。覆盖 capabilities、两次 createTurn、run、准确停止首个且保留第二个、completed snapshot、服务重启 Token 轮换、SDK 旧 Token 类型化失败、CLI 旧 Token exit 1 且给出认证提示，以及 CLI capabilities/snapshot/run 的 NDJSON 单行输出；临时脚本、DB、服务和目录已清理。ChatService 为 `admitTurn` 合约桩，不含模型调用/chat loop，不能外推完整聊天链 |
| SDK/CLI/ACP 语法 | 通过 | 三个随包 Node 脚本 `node --check` 退出 0；与上方实际 loopback 专项分层记录，均不替代完整桌面/托盘和第三方 ACP 编辑器验收 |
| 办公交付服务 | **19/19；office-document 34 通过、3 项环境跳过** | 最终 full 中的实际 LibreOffice 隔离渲染为 **8739.1022ms**，源文件保持；覆盖最终哈希/stale、结构/内容分离、`formulaCoverage`、视觉页 ID/预算、策略阶段重检与有界读取。真实 Microsoft Office COM、真实视觉模型和完整三环境矩阵仍未验收 |
| 类型检查 | **当前 freeze 通过** | UI canonical reconciliation 最终冻结后，`pnpm typecheck` 以 **2.6237 秒**退出 0；仍不替代 native、full 或正式包 |
| Biome / Lint | **当前 freeze 通过** | 同一 freeze 后 `pnpm lint` 检查 **568 个文件**，**3.5442 秒**退出 0；不替代 native、full 或正式包 |
| 生产构建 | **当前 freeze 通过** | 同一 freeze 后 `pnpm build` 以 **3.5856 秒**退出 0，main **186**、renderer **2,373**、preload **3**；正式打包入口仍会从当前源码重建 |
| 差异空白与本地链接 | **通过** | `git -c core.safecrlf=false diff --check` 与专项脚本 `node --check` 退出 0；65 份 Markdown 的 348 个本地链接按工作区和 Codex 行号语法解析后 0 缺失。其中历史调研有 31 个工作区绝对链接，不能当作安装后可移植链接，不改变既有文档分发范围 |
| 打包资源预检 | **当前源码通过** | 官方 `package-win.cmd --check` session **66510** 退出 0，核对 **13,877 项资源**、生产依赖闭包和版本 **1.3.7**；早前 session 33082 只作历史基线 |
| 根 Node 脚本 | **当前候选 19 文件、163/163 通过，0 失败/跳过/待办** | session **94617**：Node 总时长 **28,365.6638 毫秒**，退出 0；覆盖资源、打包脚本、Windows 锁定/复制和图标等仓库脚本。首跑 session **40890** 仅 `scripts/installer-visuals.test.cjs` 失败，原因是夹具仍引用旧 `updateInstaller`；改为 `preparedInstaller` 快照并保留 `assertUpdateInstallerLaunch` 位于 `app.relaunch` 前且参数仍为 `--updated` 的断言后通过，没有削弱产品检查 |
| Preload 定向 | **9/9 通过** | 当前 IPC bridge/参数边界定向退出 0；属于专项证据，不替代 Electron native 或 current-source full |
| 生图后端最终窄修 | **3 文件、117/117 通过** | 当前冻结的 image-studio service/remote 与 URL download 测试退出 0；较此前 114 项新增 DNS 等待期间 discard、30 分钟到期、policy deny 三项。域名解析采用最多 5 秒的 A/AAAA 全量公网校验，返回后对同一 pending、期限、operational、`network.request` 与 `browser.use` 全部复核，中间不再 await 后调用 opener。5 个后端/共享相关文件 Biome 通过，独立复审无 backend P1/P2；对应最终 native 和 full 另列，不与定向计数相加 |
| UI 生图定向 | **最终 freeze 15/15 通过** | `commitCanonical` 等 5-hash canonical reconciliation 修复获独立接受后，frontend queue/early-cancel/canonical 定向共 **15/15** 通过；覆盖 deferred close/delete 与直接提示词编辑的 predelete pending-save 竞态。仍不替代 image native 或 current-source full |
| 当前完整 Vitest | **225 文件：222 通过、3 环境跳过；3,131 项通过、15 跳过、0 失败** | session **23152**，退出 0，**414.67 秒**；`.impeccable/review/v137-image-concurrency-final-vitest.json`，SHA-256 `e536c3412332204fe5bd4e58e2e193362870e3fb541327e5e881cbd14bc01a9c`。使用原有断言、超时、单 worker 和 `--no-file-parallelism`；真实隔离 LibreOffice 渲染 **8684ms**、源文件不变 |
| 当前生图 Electron native | **17 组通过、17 截图、10 组几何、17 次本地请求、0 异常/服务错误** | session **71289** 退出 0 并清理测试进程/临时目录；`.impeccable/review/v137-image-unread-1795779471864/result.json`，SHA-256 `e5d587f26c4279c14d5829e9705d1d0d8b7669f1087fa0cee64c9e5f2d6fe817`。覆盖 loading/error/ready 浏览器入口、三请求重叠、第四项阻止、早/晚取消、后台完成、乱序合并、关闭画布与草稿保护、提示词恢复、中英文窄窗口 |
| 依赖审计 | 未通过，3 项 moderate；0 high、0 critical | `pnpm audit --prod --json` 退出 1，墙钟 1.893 秒；381 个依赖（328 production、53 optional）。仍为 `uuid@8.3.2` 与 `@hono/node-server@2.1.5` 公告，依赖和 lock 文件未改变 |
| 前一轮完整 Vitest | **新增功能前基线通过** | session **81543**：225 文件为 222 通过、3 环境跳过；**3,095 项通过、15 项跳过、0 失败，433.69 秒**，退出 0。JSON `.impeccable/review/v137-governance-final-accepted-vitest.json`，SHA-256 `cae4ba081de86dddbb8426cdb4ec45c4eaf76cac76afda2c4e87d54d151f8510`。该 full 早于并发生图、600 秒 generation 和 URL 浏览器打开入口 |
| 窄修复前 Vitest 基线 | 历史阶段通过 | session 22460：225 文件为 222 通过、3 环境跳过；3,094 项通过、15 项跳过、0 失败，446.44 秒。JSON `.impeccable/review/v137-governance-release-final-vitest.json`，SHA-256 `912601a738b282dcab643a39bb2222c8b9b7f5207dfcf07aba69ccce96729e2d`；只用于比较，不是最终证据 |
| 桌面 Quick Chat smoke | **31/31 通过** | `.impeccable/review/v133-quick-chat-1795758428645`。修复仅允许 `chat:stop` 接收 1/2 参数，其他 IPC 参数长度不变；非空 `runId` 和 ChatService 会话/运行所有权检查保留。覆盖运行接纳、准确停止、下一轮保留与 crash recovery |
| 桌面治理 UI native | **最终通过** | `.impeccable/review/v137-runtime-governance-ui-1795773415680/result.json`，SHA-256 `5f0524d7f73807daa255dd2f901826d05e4988dcee0fa5c07ec21bade422eba1`。3 passed、1 QuickChat separate skip、8 张截图、8 组布局、0 runtime errors，全部 `overflowX=false`；自动布局、caption hit-test、真实可见区域、`elementFromPoint` 遮挡、回执持久化与 `formulaCoverage` 展示已执行。根任务已人工查看最终 PDF 与 XLSX 公式区 480px 截图并确认面板可见。旧 sidebar 遮挡轮次只作为夹具历史。XLSX 在该受控 `SystemRoot` 中因无 PowerShell 导致 COM 启动 `ENOENT`，隔离 LibreOffice 也失败，故重算失败、渲染不可用、公式部分覆盖并保留未验证项；这不是无 Office 三环境矩阵的通过证据 |
| 正式 NSIS / ZIP | **文档冻结后独立留档** | 用户已授权正式打包；源码验证和预检已完成。新 EXE/ZIP 的版本、唯一根条目、大小、SHA-256、旁置元数据、缓存副本和随包文档核验只写入根 `AGENT.md` 最新交付节；不得沿用同版本旧包元数据 |

版本真源已复核：根 `package.json`、桌面 `package.json` 与 `apps/desktop/src/shared/release.ts` 均为 **1.3.7**，`DATABASE_SCHEMA_VERSION` 为 **11**。最终 full 的 15 项跳过与既有集合相同：Office COM 3 项、Docker/原生沙箱、外部 MCP/GitHub/技能市场现场集成及 2 项目录链接条件；没有启用真实凭据。Vitest JSON 的套件/文件 `status` 可能把 skip 计入 passed，文件统计必须采用控制台的 **222 passed / 3 skipped / 225 total**，不能把 `testResults` 状态误写成 225 个文件全部通过。

### 当前生图增强验收

| 验收项 | 当前状态 | 必须补入的最终证据 |
| --- | --- | --- |
| URL 预览默认浏览器打开 | **单元与真实 IPC 路径通过** | loading/error/ready 三态可操作；不透明 ID、过期、DNS 等待期间 discard/policy deny 均有测试；解析后复核候选和策略，再调用 opener。native 捕获 `shell.openExternal` 并注入受控公网 DNS，不实际打开用户浏览器；浏览器后续 Cookie/CAPTCHA、DNS 和导航不在受控下载器范围内 |
| 并发生图与各自的状态/取消 | **后端与 Electron 通过** | 三个本地供应商请求全部进入并保持未完成后才放行；服务及 UI 均为 3/3，第 4 项受阻。独立取消、乱序返回、跨页后台完成、晚取消等待原 promise 结算均通过 |
| generation 600 秒预算 | **有界计时测试通过** | fake timers 在 599,999ms 不终止、600,000ms 终止对应请求；预算包括请求、解析、保存和提交，已提交结果保留。URL 预览仍为 90 秒，文本润色和反推预算独立；未等待真实供应商十分钟进行付费测试 |
| 请求快照与画布合并 | **单元与 Electron 通过** | 各请求正负提示词、参考图和目标画布独立快照；新草稿保留，删除的非生成素材不被旧响应复活；延迟 close/remote-save 与 prompt 编辑交错后画布仍关闭。非 CAS 的进程崩溃窗口仍见下方边界 |
| 本轮构建、资源与正式包 | **静态、定向、native、full 与预检通过；正式产物独立留档** | 当前源码 typecheck、Lint、focused、native、full、生产构建与官方资源预检均通过。文档冻结后执行正式 NSIS/ZIP，最终产物核验仅更新根 `AGENT.md` 和旁置元数据，避免修改随包文档后包内容过时 |

专项脚本最终 SHA-256 为 `380994cc754131b6254d3d337f6d2c0af15b2514500db1462e117991e22e81c8`。根任务人工查看最终目录中的 `remote-browser-loading.png`、`remote-browser-open-error.png`、`generation-three-active-680.png` 和 `remote-en-680.png`，确认按钮、请求列表与取消入口可见；其余截图只计自动化证据。较早失败轮次全部保留，不能计为通过：涉及旧草稿未恢复、候选 discard 后基线数量、负面提示词拼接导致供应商延迟夹具未匹配、确认按钮 class、自动保存尚未持久化就取基线，以及测试切换 drawer 后未重新展开。修正均在专项脚本，产品四个关键文件哈希未变，没有放宽断言、超时或安全校验。

### 历史失败与诊断

session 7326 是收口前的失败快照，不是当前结论：221 文件为 210 通过、8 失败、3 环境跳过；3,034 项通过、11 失败、15 跳过，1,011.08 秒。8 个失败文件随后以同一进程 control full 得到 **115/115 通过、118.88 秒**，逐项 isolated 也通过。更早的 session 66945 曾全绿（220 文件：217 通过、3 环境跳过；3,037 项通过、15 项跳过，509.21 秒），但它早于后续接纳事件与 claims/parts 修复。这些结果只用于解释排查路径；session 22460 也只代表窄修复前基线，不抵消后续源码仍须 fresh full 的完成标准。

这些历史失败之后完成并已由最终 full 覆盖的真实修复包括：

- 运行状态迁移与生命周期事件在同一 savepoint 提交；事件持久化失败会回滚运行状态。
- 计划认领与心跳只接受真实 live executor，旧 generation、stale 或跨运行写入不能推进计划。
- Office 结构/内容分离、检查中文件变化返回 `stale`、独立 `formulaCoverage`、缓存 PDF 哈希复核、256 MiB 渲染输出上限和取消清理确认均已落地。
- Quick Chat 的 `chat:stop(sessionId, runId)` 两参数 IPC 只在停止通道兼容 1/2 参数；其他通道长度不变，空 `runId` 与所有权错误仍拒绝。最终 native smoke 为 **31/31**。

真实 Microsoft Office COM 重算/渲染、Office、LibreOffice、两者均未安装三环境矩阵、真实视觉模型、安装/升级/卸载以及桌面、快捷 Chat、桌宠、API、SDK、ACP 的完整一致性仍未验收。本机 LibreOffice 单项通过不能外推为所有 Windows 字体、打印机和版本环境一致。

## 历史基线：2026-11-26 全量回归与产品调研

此节记录的是后续治理改动之前的版本保持 1.3.7 工作树，只作为历史基线。该轮对当时源码执行完整自动检查，重点复核模型/工具状态、恢复、Office、模式权限、扩展、调度及图片路径，并完成[与 OpenCode、DeepSeek Harness 的调研报告](RESEARCH_HARNESS_COMPARISON_2026-11-26.md)。人工源码检查集中于这些高风险路径，不声称逐行人工审阅所有源码或证明不存在缺陷。没有根据竞品调研新增产品功能。

| 检查 | 本轮结果 | 证据 |
| --- | --- | --- |
| 完整 Vitest | 207文件，204通过、3环境跳过；**2,890项通过、15项跳过、0失败** | 694.74秒，退出0；`.impeccable/review/v137-retry-full-vitest-20261126.json` |
| 根 Node 脚本 | 163/163通过，0失败/跳过 | 54.650秒，退出0；覆盖资源、打包脚本、Windows锁定/复制、图标等 |
| 类型检查 | Node/Web两套通过 | `pnpm typecheck`退出0 |
| Lint | 532文件通过 | `pnpm lint`退出0 |
| 生产构建 | 通过 | `pnpm build`退出0；main173、renderer2363模块，三组preload |
| 打包资源预检 | 通过 | `package-win.cmd --check`退出0；13,871项资源、生产依赖闭包与版本1.3.7 |
| 桌面断流重试 | 10组场景通过，0Renderer运行异常 | `node scripts/model-retry-smoke.mjs`退出0，最终证据`.impeccable/review/v137-retry-1795675222619/result.json` |
| 桌面生图与已读 | 14组场景、13截图、10组几何、11次本地请求通过 | `node scripts/v137-image-unread-smoke.mjs`退出0，`.impeccable/review/v137-image-unread-1795674483402/result.json`；0异常/合成服务错误 |
| 依赖审计 | 未通过，3项moderate；0 high、0 critical | `pnpm audit --prod --json`退出1；适用路径与剩余债务见本页依赖审计节 |

完整Vitest的15项跳过包括Office COM、Docker/原生沙箱、外部MCP/GitHub/技能市场现场集成和两项目录链接条件测试；没有启用这些环境开关。三个整文件环境跳过不能计为通过，其余Windows文件锁、受控提交、junction、PTY及取消测试有实际执行。

## 运行治理扩展：最终证据与剩余现场边界

2026-11-27 的工作树在此前全量结果之后新增或修改了运行记录、数据库 schema 11、管理策略、工具结果契约、计划认领、办公交付服务和 `/v1` 扩展。下表区分已经通过的定向检查、源码接线和仍未覆盖的现场场景。

| 项目 | 当前证据 | 仍未覆盖 |
| --- | --- | --- |
| 统一运行 | `RuntimeService`、Headless 持久接纳、运行查询和按准确 `runId` 停止已进入最终 full；原子接纳/幂等重复 **52/52**、Runtime smoke **9/9**、Quick Chat native **31/31** | 真实第三方 ACP 编辑器、正式安装包和所有外部 surface 的长时故障切换仍不在本轮已验收范围 |
| 事件续接 | `/v1/events` 的 `after`、SSE `id`、`Last-Event-ID`、等待态并行 activity/delta、过滤游标终态和 Runtime smoke **9/9** 已通过，并纳入最终 full | 长时间生产负载下的容量回收、所有第三方客户端的实现差异和真实安装升级现场 |
| 模型等待 | `model-stream.ts` 首响应/流空闲 watchdog、5/15 分钟默认值、`0` 关闭、心跳不续期、工具/审批等待排除、重试预算和未完成工具不执行均纳入最终 full | 真实供应商在各类代理和网络故障下的长期行为仍不能由本地测试穷举 |
| 管理策略 | 6 文件 **61/61** 治理集成通过；最终 full 覆盖执行前 revision 重检、Shell/file/LSP、formatter/diagnostics、损坏策略、停止/清理、依赖与更新器分阶段门禁 | Windows ACL 的实际组织部署、所有第三方扩展入口的恶意绕过和真实管理员环境仍需现场验收 |
| 工具结果 | `ToolOutcomeService`、有界 worker Schema 校验、输出转存/索引、检查点不确定屏障和内置/MCP/自定义工具已纳入最终 full | 超大/超深恶意 Schema、远程 Schema 引用和任意外部服务的 exactly-once 不提供保证 |
| 计划认领 | **3 文件、40/40 通过**；覆盖 live executor、stale/跨运行写入防护、真实父子授权，以及外部 `settle.expectedVersion` CAS。generation、原子认领、1 分钟心跳、5 分钟租约及 `/v1` 的 `claim/heartbeat/settle/recover` 已进入窄修复冻结源码 | 跨机器调度、真实多进程文件系统和长时间租约风暴未验收 |
| 数据迁移 | schema 11 保留旧数据；schema 10 升级前 `VACUUM INTO` 完整备份。本轮 migrations **17/17**，含 v11 备份、失败回滚和重开路径 | 真实用户数据库副本、降级后人工恢复演练和异常断电矩阵 |
| 办公交付 | `OfficeDeliveryService` **19/19**、`office-document` **34 通过/3 环境跳过**；本轮 full 中真实 LibreOffice 隔离渲染 **8739.1022ms**、源文件保持。主 CodeAgent/WorkAgent 的受控自动回执、`formulaCoverage`、预算和 3 轮修复上限已接入 | 真实 Microsoft Office COM、真实付费视觉模型、Office/LibreOffice/均未安装完整三环境矩阵、极端字体/打印机差异和正式安装包现场 |
| 开发者接口 | Runtime/Headless 窄修复 **2 文件、30/30**，Runtime smoke **9/9**、ACP bridge **10/10**；实际 SDK/CLI 对实际 Headless/Runtime/临时 SQLite 的 loopback 专项通过 capabilities、幂等建轮、run、精确停止、snapshot、Token 轮换、旧 Token 类型化失败及 NDJSON 单行。Chat idempotency 另有真实定向 **1/1** | loopback 专项的 ChatService 为 `admitTurn` 合约桩；全部 SDK 方法、真实第三方 ACP 编辑器、桌面/托盘/快捷 Chat/桌宠的完整长时一致性仍需后续矩阵 |

桌面重连脚本更新了旧的“收到半截输出就重置重试额度”断言，改为同一次模型请求固定额度。实际通过：两次503后恢复；已完成文件仅写一次且工具卡片可见；重试保留工具定义；未完成写入不执行；每次都输出半截内容仍在初始请求加两次重试后失败；半截文本不进入普通历史；取消服务端5分钟等待、403立即停止、关闭/耗尽重试、定时任务和真实派生子Agent恢复；重载后设置持久化与中英文紧凑布局。

该脚本还修正为按主页面URL选择CDP目标，使用仓库实验运行时定位器、独立证据目录，并在刷新时等待新文档标记，避免旧页面DOM让断言过早通过。前次复跑的九组核心检查通过后，最终刷新阶段遇到`Inspected target navigated or closed`，证据保留在`.impeccable/review/v137-retry-1795674791437/failure.json`；修正同步后最后一次从头10组通过。旧记忆摘要夹具长度不足也已改成符合既有规则的合成内容。没有为测试改变产品代码、关闭防护或削弱断流行为断言。

人工抽查了最终已完成工具卡片截图、重试耗尽诊断，以及生图英文680宽度预览，未发现这些场景的操作阻塞；其余截图属于自动化证据，不声明逐张人工检查。所有桌面回归均使用临时profile/项目和本地合成服务，未读取正常用户数据库/Key或调用付费模型。URL图片传输使用受控内存夹具，公网DNS/重定向防护仍由下载器单测覆盖。

本轮发现根目录已有MIT `LICENSE`，但两个包仍声明`UNLICENSED`，旧README/交接写成无根许可证。已纠正文档事实并在调研报告列出待统一项，没有更改许可元数据或替维护者作许可决定。**在2026-11-26这次全量结果之后**，工作树又增加了首包/空闲watchdog源码和测试；因此旧结果不再覆盖当前全部功能，但也不是“watchdog已验证通过”。没有重新引入SubAgent固定总运行时限，新增等待检测只约束单次模型请求。

本轮未运行正式NSIS打包、安装、升级或卸载；未测试真实付费供应商、全部Office/隔离后端与Windows设备矩阵。既有安装器不包含后续断流修复，本轮生产构建不能替代新安装包。本次也没有执行云SQL、提交、推送或上传发布。

## 历史增补：独立生图协议

### 实现范围

- 供应商增加 `openai_images`，界面为 `OpenAI /v1/images`。Base URL 必须填写到 `/v1`；包含完整 `/images/generations` 或 `/images/edits` 端点时明确拒绝，防止重复拼接。
- 新增、手动添加和从模型列表导入的模型默认锁定为仅图片输出。即使 IPC、脚本、Headless 或旧客户端省略输出模态，后端也默认图片；显式文本或混合输出、工具调用和不兼容的协议切换仍会拒绝。界面隐藏不适用的上下文、输出 token、思考、工具及提示缓存配置。
- 纯图片协议拒绝提示缓存配置；文本协议切换到该协议时，在事务内清除旧缓存设置，清理失败会回滚协议切换。
- 无参考图使用标准同步 `POST /images/generations` JSON；参考图使用 `POST /images/edits` multipart。不会发送 Chat/Responses 正文、token、`async`、`stream` 或遗留 `response_format` 字段。
- 保留已有 Responses / Chat Completions 下的图片专用模型。纯生图供应商不进入文本模型选择器，并在文本流、润色及反推的网络请求前拒绝错误使用；语言模型另行选择。
- 新增永久 schema 10 迁移，扩展供应商协议 CHECK，保留 schema 1–9 及用户数据。重建供应商表前在事务外关闭 FK，事务内检查全部外键，失败回滚并恢复 FK。新数据库不能直接用只支持 schema 9 的旧程序打开；降级前须使用升级前的完整备份。
- 用户提供的公司 Skill 仅作为接口数据研究，没有加载、安装或执行，也未复制公司地址、凭据、工作流指令或专有异步任务接口。
- 版本仍为 `1.3.7`，原子图标、依赖版本及锁文件不变，政策修订仍为 `2026-11-04.3`。

### 最新检查

| 检查 | 状态 | 实际证据 |
| --- | --- | --- |
| 生图/存储/能力定向测试 | 已通过 | root 串行7文件150项通过，包含新旧协议生成、multipart多图、禁用文本用途及既有URL/素材行为 |
| 供应商与共享层 | 已通过 | 最终定向实际30文件、690项通过；覆盖协议默认图片、显式文本/混合/工具拒绝、缓存写入拒绝、切换清理与回滚，不与最终全量数字重复相加 |
| 数据迁移与关联回归 | 已通过 | 存储3文件54项，队列/模型目录/会话目录3文件81项通过；覆盖schema1–9升级、V10回滚、FK恢复、重开与数据保留 |
| 类型检查 | 已通过 | `pnpm typecheck`，Node/Web两套退出0 |
| Lint | 已通过 | `pnpm lint`，Biome532文件退出0 |
| 生产构建 | 已通过 | `pnpm build`退出0，main173/renderer2363模块；正式打包还会再次重建 |
| 完整Vitest | 已通过 | 207文件：204通过、3环境跳过；2887项通过、15项跳过、0失败；454.92秒，退出0；报告`.impeccable/review/v137-final-vitest.json` |
| 根Node脚本 | 已通过 | 最终源码19文件、163/163项通过、0失败/跳过，43.662秒，退出0 |
| 隔离Electron专项 | 已通过 | `scripts/v137-image-unread-smoke.mjs`退出0，14场景、13截图、10组几何、11次本地合成请求，0异常/服务错误 |
| 资源预检与正式包 | 独立交付 | 文档冻结后由根任务执行官方`package-win.cmd --check`及`package-win.cmd`；精确结果与独立核验见根`AGENT.md`第92节 |

最新桌面证据：`.impeccable/review/v137-image-unread-1795605629497/result.json`。最终冻结源码重建后，真实界面创建 Images 供应商、手动添加及从模型发现导入均验证图片专用选项 checked+disabled、无可见 token/模态配置，连接页无缓存表单，缓存拒绝生效时供应商仍可正常创建。语言模型菜单只包含文本供应商。标准 JSON 生成和单参考 multipart 编辑到达正确端点，旧 Responses 图片模型仍可生成；未出现文本字段或自定义异步字段。URL 预览重试、确认保存、原始正负提示词、回导、跨页面和重载持久化、一键已读及中英文窄窗口布局继续通过。人工查看了最新 Images 供应商创建和模型发现导入截图，没有发现布局阻塞；其余截图为自动化产物，不声明逐张人工审阅。

专项只使用独立临时profile、本地合成服务和随机测试凭据。URL预览的图片传输仍为内存夹具，公网DNS/重定向防护由下载器单测覆盖；没有调用公司接口、真实Key或付费供应商。未连接BrowserDo/Embiody，未运行安装器；不将模拟API通过写作所有兼容网关已验收。标准Images不包括供应商特有`async=true`、`/images/tasks`轮询、流式图像事件、遮罩绘制或Outpainting工作流；未知参数/模型能力依旧由供应商明确报错，不猜测或自动切换协议。

协议研究依据为OpenAI官方[图像生成API](https://developers.openai.com/api/reference/resources/images/methods/generate)与[图像编辑API](https://developers.openai.com/api/reference/resources/images/methods/edit)。本轮采用同步JSON/Multipart及`data[].b64_json`，兼容URL候选仍遵循既有预览确认安全路径；没有照搬公司示例的自定义异步端点。

## 首轮1.3.7基线

以下记录全局已读与URL图片确认的前一轮验证历史。其测试数量和安装包交付不能替代上方独立Images协议的最新回归。

## 本轮范围

- 顶栏提供“一键已读”，清除所有 CodeAgent、WorkAgent、ChatAgent 会话的完成未读状态和 Windows 任务栏未读数字。
- 生图供应商响应可混合包含 Base64 图片与远程图片 URL，不再因 URL 项直接拒绝整批结果。
- URL 结果先通过主进程安全下载到有界预览内存，显示应用内预览与本次生成提示词；用户确认后才作为普通生成素材保存。
- 确认保存保留原始正面、负面和修订提示词，并接入素材回导、画布、下载、批量导出和删除流程。
- URL 下载只允许公开 HTTPS，拒绝凭据、私网、回环、本机、保留地址、不安全重定向及 DNS 重绑定，并限制图片、响应、时间和像素资源。
- 版本与文档保持 1.3.7，协议修订号保持 `2026-11-04.3`。

## 验证状态

| 检查 | 状态 | 证据或待办 |
| --- | --- | --- |
| 版本真源 | 已完成 | 根 `package.json`、桌面 `package.json`、`apps/desktop/src/shared/release.ts` 同步为 `1.3.7` |
| 内嵌文档版本头 | 已通过 | 11 个预检 Markdown 的版本头及实际生产依赖资源检查通过 |
| 全局已读单元/集成测试 | 已通过 | `completion-notifications.test.ts` 21项，覆盖跨模式清空、持久化、badge/overlay 和已有通知行为 |
| URL/Base64 混合解析测试 | 已通过 | `image-provider.test.ts` 22项，覆盖混合结果、无效项逐项警告、数量、Base64和原有图片校验；连接测试可识别URL响应但不下载 |
| URL 下载安全测试 | 已通过 | `image-result-download.test.ts` 22项，夹具覆盖DNS/连接地址绑定、逐跳重定向、危险地址、凭据隔离、停滞DNS的取消和90秒超时、格式与字节预算 |
| URL 预览确认测试 | 已通过 | `image-studio-remote.test.ts` 11项，覆盖确认前不落盘、预览/保存/丢弃、提示词绑定、过期与关闭、缓存预算、部分失败及取消 |
| 一键已读/URL生图桌面测试 | 已通过 | `scripts/v137-image-unread-smoke.mjs`退出0；10组场景、10张截图、10组几何、8次本地请求，0异常和0服务错误 |
| 定向 Vitest | 已通过 | 上述4文件共76项已包含在最终全量通过结果中；早期一次测试夹具因无assets目录报ENOENT，修正为核实无落盘后重验通过 |
| 完整 Vitest | 已通过 | 207文件：204通过、3环境跳过；2,866项通过、15项跳过、0失败；364.63秒，退出0 |
| 根Node脚本 | 已通过 | 19文件、163项通过、0失败/跳过；28.61秒，退出0 |
| 类型检查 | 已通过 | `pnpm typecheck`，Node/Web两套TypeScript退出0 |
| Lint | 已通过 | `pnpm lint`，Biome检查532文件，退出0 |
| 生产构建 | 已通过 | `pnpm build`，main173模块/preload3入口/renderer2363模块；正式打包入口还会重建 |
| 资源/生产依赖预检 | 已通过 | `package-win.cmd --check`核对13,871项资源、生产依赖闭包和版本1.3.7，退出0 |
| 正式 NSIS / ZIP | 独立交付记录 | 文档冻结后执行`package-win.cmd`；精确结果及独立核验见根`AGENT.md`第91节和发布目录旁置元数据 |
| 安装 / 升级 / 卸载 | 未验收 | 正式包生成后另行运行验证 |
| 发布 SQL / 上传 / 发布 | 未执行 | 用户本轮未要求；不得沿用 1.3.6 ZIP 元数据 |
| 差异空白检查 | 已通过 | `git diff --check`退出0，只有仓库既有LF→CRLF提示 |

## 历史源码检查命令：并发生图冻结轮

```powershell
pnpm --filter @mingshen/desktop exec vitest run --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile.json=../../.impeccable/review/v137-image-concurrency-final-vitest.json
pnpm typecheck
pnpm lint
pnpm build
$scriptTests = rg --files scripts | Where-Object { $_ -match '\.test\.(cjs|mjs)$' }
node --test $scriptTests
.\package-win.cmd --check
git -c core.safecrlf=false diff --check
```

该历史冻结轮的完整 Vitest 为 `.impeccable/review/v137-image-concurrency-final-vitest.json`，session 23152 使用原有断言、超时、单 worker 与 `--no-file-parallelism` 串行通过：**222 passed / 3 skipped / 225 total；3,131 项通过、15 项跳过、0 失败**。JSON 中套件或文件对象可能把 skip 状态映射成 passed，不能把 3 个跳过文件改写成通过。Windows 原生文件、进程、Git、文档和本地数据库测试使用各自临时目录；15 项环境跳过不计为已通过。根 Node 脚本为当时 session 94617 的 163/163；依赖审计保留 3 项 moderate 和退出 1 的边界。这些结果早于诊断修复，只代表对应历史快照。

## 桌面专项

专项使用独立临时profile、临时项目及本地合成模型，不读取正常用户数据库或真实Key。远程图片下载在临时Electron调试进程中使用内存夹具；DNS与下载策略由独立下载器测试覆盖，不将该夹具冒充真实公网供应商验收。

```powershell
node scripts/v137-image-unread-smoke.mjs
```

最终冻结源码重建后的执行退出0，证据为`.impeccable/review/v137-image-unread-1795605629497/result.json`：**14组场景、13张截图、10组几何检查、11次本地合成请求，0主进程/Renderer异常、0合成服务错误**。实际运行Code/Work/Chat三个主会话形成3个未读完成，通过真实顶栏指针操作清空，核对SQLite持久值、`app.setBadgeCount(0)`和Windows overlay清除调用；切换模式和重载后保持已读。此项记录Electron调用结果，不冒充外部Windows任务栏像素识别。

URL-only生图响应展示3个候选和原始正面、负面、修订提示词；验证稍后重开、单次预览失败与重试、真实保存IPC/SQLite落盘、保存时不使用后来编辑的工作区提示词、丢弃清理、普通Base64生成、跨工作面和重载持久化，以及确认覆盖后回导提示词。最终候选、未读和角标为0，未出现非夹具fetch。中文1440/800/680及英文800/680宽度的顶栏与预览弹窗检查无视口溢出、操作遮挡或窄屏水平滚动；人工抽查英文680预览与中文680未读截图，未见布局阻塞，其余截图为自动化产物，不声称逐张人工审阅。

前序运行未全绿的原因及修正均限于专项脚本：把不存在的`desktopAction("hide")`改为有效的`"tray"`；转为主进程读取badge探针并在截图前恢复可见窗口；角标改为检查视口和实际裁剪祖先，保留按钮有意外溢的布局；重开后先展开提示词详情；等待防抖自动保存落盘；候选只剩一张时按真实数据与隐藏切换标签的产品行为断言。最后一次完整从头运行通过，没有为测试放宽产品安全策略、修改CSS或跳过失败场景。最近失败证据保留于`v137-image-unread-1795599695767/failure.json`及更早同前缀目录，最终结果以本节成功记录为准。

## 依赖审计

`pnpm audit --prod`报告3项中等严重性公告：`exceljs > uuid`的`GHSA-w5hq-g745-h8pq`，以及`browserdo-mcp > @modelcontextprotocol/sdk > @hono/node-server`的`GHSA-qv5m-9pm6-hqp3`和`GHSA-jpvv-r467-5p4w`。该命令退出1，不记作通过；本轮没有升级依赖或改变锁文件，公告适用条件和残留边界另行记录。BrowserDo/Embiody按既有约束不做真实连接测试。

只读核对锁文件和依赖调用路径：`exceljs@4.4.0 > uuid@8.3.2`目前仅调用`uuid.v4()`，该公告涉及的`v3/v5/v6`带buffer调用没有出现在现行Office路径。`browserdo-mcp@0.9.3 > @modelcontextprotocol/sdk@1.32.2 > @hono/node-server@2.1.5`的两个公告分别涉及Hono异步WebSocket upgrade异常和反向代理路径ACL；Harness默认以stdio启动BrowserDo，没有启用这两条Hono HTTP路径。这降低了当前路径的暴露面，但不消除依赖扫描债务；以后启用相应HTTP/WebSocket transport、反向代理或受影响UUID API时必须重新评估。此次未把只读源码判断写作真实攻击复现或修复通过。

## 安全边界

URL 是不可信的供应商输出。候选地址和返回内容在用户确认前只作为有限预览数据，不获得素材记录、画布引用或提示词回导身份。下载器必须在不携带模型凭据、Cookie、Referer、浏览器存储或用户自定义鉴权的前提下发起请求，并针对每一次连接及重定向重新验证目标。DNS 预检与真正连接必须绑定同一已验证地址，避免预检后重解析到私网。

确认下载只能使用本次生成请求在主进程保存的提示词 provenance，不能接受 Renderer 自行提交的任意提示词覆盖。URL 候选应绑定真实请求、当前用户数据目录和短期标识；过期、已关闭、重复确认或来自其他请求的候选必须拒绝。下载失败不能影响同批已经成功验证的 Base64 图片，也不能留下半写素材、临时文件或孤立提示词记录。

即使地址通过公网策略，第三方图片主机仍可能记录请求来源、时间和网络信息，其保留与内容政策不受 Mingshen Harness 控制。URL 成功下载也不证明供应商拥有图片权利、内容安全或与提示词完全一致。

## 尚未覆盖

- 本轮不自动安装 Microsoft Office，不改变 Office COM 检查边界。
- 不执行云端发布 SQL、不上传 GitHub Release、不提交或推送仓库。
- 未使用真实 API Key、正常用户数据库、付费供应商或私有网络夹具进行测试。
- 恶意地址、超限响应、取消、超时和DNS重绑定用受控夹具覆盖；真实恶意公网图片主机、真实DNS劫持、系统代理、断网、磁盘耗尽和杀毒软件竞争未做现场验收。
- Windows安装、升级和卸载未运行；正式包生成、ZIP内容及SHA/大小核验不能替代安装器实际运行证据。
- 画布全图保存尚无跨进程 revision/CAS 事务。如果旧全图保存恰好排在生图提交之后，Renderer 又在纠正保存前崩溃，画布可能缺少该轮新增图层；主进程素材记录和图片仍保留。正常运行中的串行合并、关闭、删除与草稿竞态已有单元及 Electron 覆盖，不把这些结果外推为断电或任意进程崩溃下的原子性保证。

## 后续源码修复：模型断流重试

1.3.7后续源码修复把每次模型请求的重试预算固定为初始请求以外的 0–20 次；部分文本、思考或工具参数不再重置额度。未取消请求下的 `AbortError` 可按瞬态传输错误重试，用户主动取消仍立即终止。重试请求保留完整工具定义；失败尝试的半截 assistant 文本不写入普通历史，未完成工具不会执行，已经完成的工具、文件修改与检查点保留且不会重放。界面恢复已完成工具卡片的显示，并在任务结束后保留可展开的重试诊断。

修复当时的定向验证：`model-retry.test.ts`、`model-retry-runtime.test.ts`、`model-stream.test.ts` 与 Renderer `activity-details.test.ts` 共 **4 个文件、135 项通过**。`pnpm --filter @mingshen/desktop typecheck`、`pnpm lint`（532文件）及`git diff --check`通过。该次定向验证后未立即执行全仓Vitest或重新构建；后续完整回归见本页顶部。修复发生时的旧 1.3.7 包不能代表当前源码，最新正式包以根 `AGENT.md` 最新交付节与产物旁置元数据为准。
