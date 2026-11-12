# Mingshen Harness 1.3.0 验证记录

日期：2026-11-08（Asia/Shanghai）。本轮将应用版本更新为 1.3.0，并新增工作区内的 DOCX、PPTX 和 PDF 制作能力。本文只记录已经实际核对的范围；源码定向测试不等于完整桌面、安装包或第三方供应商验收。

## 本轮范围

- 新增内置 `create_document` 工具。目标路径扩展名决定输出格式：`.docx`、`.pptx` 或 `.pdf`。
- DOCX 使用 Office Open XML 作者库，保留可编辑文本、列表、表格、分页和本地图片；PPTX 保留可编辑幻灯片、文本、表格、图片和讲者备注；PDF 使用应用内 Chromium 离线排版并保留可选择文字。
- 输入采用有界结构化 schema，支持标题、段落、列表、表格、分页、幻灯片、备注和工作区内 PNG/JPEG。图片必须单独经过工作区读取与权限检查，不从网络地址加载。
- 生成写入沿用普通文件的审批、隔离、计划/Agent profile、patch-only、写入 lease、外部修改检查和取消保护。默认不覆盖已有文件；只有显式 `overwrite:true` 才允许覆盖，并在写入前核对当前哈希。
- 失败、拒绝、取消和外部修改冲突不会提交半成品；临时文件清理失败不会掩盖已经提交的完整输出，但会在工具结果中报告。
- 不要求安装 Office、Python、pandoc、LibreOffice 或网络转换服务。旧 `.doc` / `.ppt` 不是输出格式，也不承诺对现有 Office 原稿做无损编辑。

## 源码定向验证

以下命令在仓库根目录执行，使用临时夹具，不读取用户数据库、真实模型 Key、剪贴板或付费供应商：

| 检查 | 实际结果 |
| --- | --- |
| `pnpm --filter @mingshen/desktop exec vitest run --no-file-parallelism src/main/documents/document-author.test.ts src/main/documents/document-pdf.test.ts src/main/documents/document-creation-tools.test.ts src/main/chat/document-authoring-runtime.test.ts` | 4 个文件通过，74 项测试通过 |
| `pnpm --filter @mingshen/desktop exec vitest run --no-file-parallelism --testTimeout 120000` | 98 个文件通过，3 个环境跳过；905 项通过，9 项环境跳过 |
| `pnpm --filter @mingshen/desktop typecheck` | Node/Web TypeScript 通过 |
| `pnpm --filter @mingshen/desktop lint` | Biome 269 文件通过 |
| `pnpm build` | main/preload/renderer 生产构建通过（main 97、preload 3、renderer 2217 模块） |
| `pnpm --filter @mingshen/desktop package:check` | 33 项资源、生产依赖、版本 1.3.0 通过 |
| `node --test scripts/package-document-runtime.test.cjs scripts/package-paths.test.cjs scripts/package-runtime-copy.test.cjs scripts/package-native-copy.test.cjs` | 16 项打包/资源测试通过 |
| `pnpm audit --prod` | 无已知生产依赖漏洞；`image-size` 已覆盖到 2.0.3 |
| `node --check scripts/document-authoring-smoke.mjs` | 通过 |
| `node --check scripts/document-asar-smoke.cjs`、`node --check scripts/check-package.cjs` | 通过 |
| `git -c core.autocrlf=false diff --check` | 通过 |

定向测试覆盖：

- 真实 DOCX/PPTX 结构解析、中文文本、原生表格、分页、讲者备注和图片字节；
- PDF 打印请求的 HTML 转义、页面规格、取消、失败和可选中文字路径；
- 请求批准拒绝、独立图片读取批准、Native/Docker 二进制网关和路径边界；
- 默认拒绝覆盖、显式覆盖、外部修改冲突、临时清理异常、取消和半成品清理；
- 原生 Memory、`.git`、TencentDB 记忆目录、工作区外路径和网络图片拒绝。

## 真实 Electron 验证

`scripts/document-authoring-smoke.mjs` 已准备为串行真实 Electron 夹具。它使用独立系统临时 profile、临时工作区和本地 SSE，不调用付费模型；脚本会核对 1.3.0、双语内嵌手册/更新日志、DOCX/PPTX/PDF 三种 round trip、中文/表格/图片/分页/备注、默认覆盖拒绝、显式覆盖和请求批准拒绝，并输出 PDF 页面 PNG 与 DOCX 语义预览。

实际运行结果：

- `node scripts/document-authoring-smoke.mjs` 通过：7 个场景、16 次 Agent 请求；真实生成并回读 DOCX/PPTX/PDF，检查中文、原生表格、图片、分页、讲者备注、默认覆盖拒绝、显式覆盖和请求批准拒绝。证据目录由脚本写入 `.impeccable/review/v130-document-authoring-*`。
- `node scripts/document-asar-smoke.cjs` 通过：临时 ASAR/解包目录中的离线 OCR、PDF 页面渲染、legacy DOC 读取，以及包内 DOCX/PPTX 作者库和依赖闭包。

首次真实 PDF smoke 发现隔离打印页禁用 JavaScript 后仍调用受控 readiness 脚本，Chromium 返回 `Script failed to execute`；已保留 sandbox、contextIsolation、无 Node、禁网络/权限/导航/下载，只将打印页的受控 readiness 执行开关设为 `javascript:true`，随后完整 smoke 通过。

本轮没有生成或安装 NSIS/ZIP 正式包，也没有执行云 SQL；`package:check`、ASAR smoke 和源码构建不等于安装、升级、卸载或所有 Windows 矩阵验收。

## Agent 子模型配置补充

本轮补充验证了设置中可作为子 Agent 调用的 profile 模型选择：

- `subagent` 和 `all` profile 显示“子 Agent 模型”，可选择继承主会话模型或单独指定已启用模型；禁用模型不出现在选择项中，`primary` 与 `plan` 不显示该覆盖设置。
- `@Agent` 手动调用和 `spawn_subagent` 自动委派均通过共享解析函数决定模型。独立模型跨 provider 时同时切换 provider；空值保持父会话 provider/model。
- profile 保存保留已有 `modelId` 数据，以兼容历史配置；`primary`/`plan` 的历史值不会在子任务路由中生效。指定模型不可用、禁用或父模型失效时返回明确配置错误。
- 子 Agent 内嵌提示词、中文/英文手册、更新日志和 README 已同步，不引入新的 schema、凭据、远端记忆服务或腾讯业务适配。

源码定向命令：

```text
pnpm --filter @mingshen/desktop exec vitest run --no-file-parallelism src/shared/agent-profile-model.test.ts src/main/agents/agent-profile-service.test.ts src/main/chat/subagents.test.ts src/main/chat/chat-service.test.ts
```

上述定向命令最终通过：4 个测试文件、39 项通过，覆盖角色资格、继承/独立模型、profile 保存、自动委派、禁用模型拒绝及手动 `@` 跨 provider 路由。

补充后的全量源码验证：

```text
完整串行 Vitest：99 个文件通过、3 个环境跳过；922 项通过、9 项环境跳过（135.72秒）
Node/Web TypeScript：通过
Biome：271 文件通过
生产构建：main98 / preload3 / renderer2218 模块通过
package:check：33 项资源、生产依赖和 1.3.0 版本通过
Impeccable detector：AgentSettings.tsx 无发现
```

真实 Electron 设置回归：`node scripts/agent-selection-smoke.mjs` 9 组通过、8 次本地 SSE 模型请求。新增断言实际切换 `primary`/`plan`/`all`/`subagent`，确认子模型字段仅对 `all`/`subagent` 可见、选项包含启用的本地模型、profile 保存所选 `modelId`。截图写入 `.impeccable/review/agent-model-2026-11-08-3/`，原有截图未覆盖。该脚本的 Agent 字段定位器与 JSON 空白断言也一并修正，以适配现有内嵌表单和实际提示词序列化格式。

本轮没有生成 NSIS/ZIP 正式包，也不执行云 SQL；源码构建和包资源预检不代表安装、升级或卸载验收。

## 文档与资源同步

1.3.0 的作者能力已同步到：

- `README.md`、`SECURITY.md`、`THIRD_PARTY_NOTICES.md`；
- `docs/USER_GUIDE.md`、`docs/USER_GUIDE.en.md`；
- `docs/CHANGELOG.md`、`docs/CHANGELOG.en.md`；
- `docs/PRIVACY_POLICY.md`、`docs/PRIVACY_POLICY.en.md`；
- `apps/desktop/resources/prompts/tools.md`；
- `AGENT.md`、`AGENTS.md`、`docs/SUPABASE_DEPLOY.md` 与 `supabase/README.md`。

版本入口保持 1.3.0；schema7、永久本地迁移、协议修订号 `2026-11-04.3`、原子图标、权限和隔离边界没有因本轮作者能力改变。TencentDB 仅以本地记忆核心形式保留，文档制作不接入腾讯业务适配、云端记忆服务或额外数据接收方。

## 交付边界

- 本轮不生成、安装或验收 NSIS/ZIP 安装包，不执行云端 SQL，不提交或发布 Git。
- PDF 版式受 Chromium、系统字体和输入内容影响；不同 Windows 的字体替代可能改变分页。PPTX 文本/表格框有容量边界，过长内容应拆页。
- 定向测试不代表所有 Office 阅读器、PDF 阅读器、Windows DPI、字体、第三方网关或恶意文档的兼容性；也不提供企业安全认证。
- 实验入口仍为 `.\run-experimental.cmd`。源码修改后先重新 `pnpm build`，正式打包由用户在根目录运行 `.\package-win.cmd`。

## 2026-11-09 原生状态与工具闭环补充

本节对应用户在调研后授权的五项优化，版本继续1.3.0，schema7、永久迁移、协议修订号`2026-11-04.3`与既有未提交实现保留。前文文档制作/Agent子模型结果是历史证据，不能代替本轮运行。

本轮实现范围：

- Responses校验并保存实际返回的加密reasoning/compaction项、assistant phase及工具身份，按provider/model/endpoint与可见内容重放；保留进展/最终答复区分，不保存可读取的原始隐藏思维链，不宣称实现服务端`/responses/compact`。请求token估算跳过reasoning/compaction密文字符串长度，以每项1024、合计最多8192且不超过模型窗口5%作有界预留，保留实际usage校准，不保证精确token数。
- `view_image`通过已批准工作区读取返回PNG/JPEG/WebP/GIF原生图像内容，单图20MiB，沿用图像模型资格及隔离路径。
- `browser_screenshot`按比例将可见页面截图最长边限制到2048像素，PNG上限8MiB；保存PNG并以`tool_result.images`将实际像素传入下一次视觉模型请求。无image能力时明确提示且不发送图片，与`view_image`20MiB限制区分。
- `exec_command`/`write_stdin`提供本轮受管管道会话、输出轮询、输入、EOF和停止；绑定原run/session/security scope，收尾等待受管进程/容器清理。清理未确认保留writer屏障与lease；当前已结束句柄的cleanup失败不会自动重试，恢复可能需重启，清屏障不代表进程/容器停止。不提供PTY或任意脱离daemon的OS级回收保证。
- `read_file`行范围/`limit`/UTF-16 `char_offset`分页与后续游标，仍保留全源hash与外部修改检查。模型并行工具开启时，相邻独立内置读最多3个并发，各自保留审批/隔离/预算；链、命令、写入、浏览器、MCP和custom不并行化。
- 可写managed child排队最多6条项目验证，`wait_subagents`只收集请求，当前模型轮全部tool_result保存完后，父会话再按自己的策略、计划、审批、隔离和writer lease顺序执行并保存独立结果，保持Chat/Anthropic调用与结果配对；父会话仍有运行中命令则保持pending。子命令工作区继续只读，排队不算通过。
- 新Token Saver配置默认关闭轮次提前摘要并使用Auto；已有明确配置和85%压力保护保留。原生状态/带图结果整消息不做可见文字变换；指纹覆盖endpoint/scope与内容摘要，阈值不按opaque/base64字节膨胀。

已执行的补充定向检查：

| 命令 | 实际结果 |
| --- | --- |
| `pnpm --filter @mingshen/desktop exec vitest run src/main/token-saver/token-saver.test.ts src/main/token-saver/stable-input.test.ts src/main/chat/compaction-request-cache.test.ts` | 3文件53项通过 |
| `node --test scripts/harness-eval.test.mjs` | 9项通过，含本地HTTP假应用；不是实际Electron或付费模型 |
| 七个相关Token Saver/compaction cache TypeScript文件的 `biome check --write` | 通过，无格式修改 |

上述测试覆盖缺失字段默认值/明确旧配置、重启不改配置、原生state/image文本精确保留、旧ledger替换拒绝、opaque/image/phase/endpoint改变使指纹失效且ledger不落原字节、摘要阈值不按opaque/base64文本膨胀。全量源码、生产构建、桌面与隔离的最终结果应另按实际命令追加，不能从这些定向结果推导。

### 可复现任务基线及观测边界

`scripts/harness-eval.mjs`固定六类任务：原生状态续接、真实图片检查、`exec_command`/`write_stdin`长命令、文件分页、两个子任务汇总和长历史约束保留。`node scripts/harness-eval.mjs`默认只运行离线合成评分夹具，创建并清理自己的临时目录，不调用模型。两份相同输入应产生一致报告；合成“通过”不代表真实模型质量。

可参考`live-config.example.json`显式开启独立测试profile的回环API模式，须设置`MINGSHEN_HARNESS_EVAL_LIVE=1`，仅接受`127.0.0.1`与环境变量中的本地API Bearer，不读取用户数据库或供应商Key。它创建/删除自己的会话、保留输入完整性证据，若会话删除未确认则保留临时工作区。API元数据校验协议、真实Model ID、reasoning、窗口和输出配置，不能证明供应商内部实际后端。

报告分别展示成功率、观测覆盖、耗时、已报告tokens；缺少遥测为`not_observed`/`incomplete`，仅completed工具算执行证据。当前本地API没有wire追踪或Token Saver配置读取，原生state/image保存在历史不能证明它们已重放到请求；因此live模式也不认证完整Token Saver A/B。轨迹只覆盖可得的主会话usage，重试、压缩、标题、记忆及子任务可能缺失，不能当总账单。本轮未使用真实付费供应商运行该基线。

README、SECURITY、中文/英文手册、更新日志、隐私说明和AGENT交接同步；没有生成安装包、执行云SQL或改政策版本。

### 本轮最终全量结果

以下为2026-11-09本轮实现收尾后的实际运行。源码测试、构建和桌面检查顺序执行；所有模型请求使用独立临时profile、临时项目和本地SSE，不读取正常用户数据库、Key或剪贴板，不调用付费模型。前文905/922项为历史结果，不替代本节。

| 检查 | 最终实际结果 |
| --- | --- |
| `pnpm.cmd --filter @mingshen/desktop exec vitest run --no-file-parallelism --testTimeout 120000` | 105文件通过、4文件环境跳过；1009项通过、10项环境跳过，176.98秒 |
| `pnpm.cmd typecheck` | Node/Web TypeScript均通过 |
| `pnpm.cmd lint` | Biome 280文件通过 |
| `pnpm.cmd build` | main100 / preload3 / renderer2218模块通过，实验out已更新 |
| `.\package-win.cmd --check` | 33项资源、生产依赖、原生哈希及1.3.0版本通过；未制作安装包 |
| `pnpm.cmd audit --prod` | 无已知生产依赖漏洞 |
| 七个Node测试文件 | 45项通过：文档打包、路径、运行时复制、原生复制、实验图标、TencentDB打包和任务基线 |
| 脚本语法及JSON | 67个JavaScript、6个PowerShell脚本语法通过；Node `JSON.parse`核对30个JSON通过 |
| `node scripts/harness-eval.mjs` | 六任务乘两合成变体，共12项通过；`modelQualityMeasured:false`，六组比较均为`comparable:false` |
| 收尾核对 | `git -c core.autocrlf=false diff --check`通过；三个版本入口保持1.3.0、政策修订号不变，13份相关文档存在，交接/验证记录的25个本地链接有效 |

七个Node测试文件的可复现命令：

```powershell
node --test scripts/package-document-runtime.test.cjs scripts/package-paths.test.cjs scripts/package-runtime-copy.test.cjs scripts/package-native-copy.test.cjs scripts/prepare-experimental-runtime.test.cjs scripts/tencent-memory-package.test.cjs scripts/harness-eval.test.mjs
```

本轮源码回归覆盖三协议图像工具输入、Responses原生项及phase的完整响应提交/重放/切模型失效、opaque估算、管道stdin/轮询/停止/作用域、审批与清理屏障、分页及全源hash、受控读取并发、父会话检查转交与工具配对，以及既有记忆、压缩和Agent模型配置。

### 本轮真实桌面回归

以下九个脚本均启动真实Electron、顺序运行并完成各自清理。模型响应是本地夹具，进程、文件、浏览器、子任务及审批执行路径是真实应用代码。

| 脚本 | 最终实际结果 |
| --- | --- |
| `harness-capabilities-smoke.mjs` | 4组、17请求通过：native3 / terminal5 / vision4 / relay3 / relaychild2；失败数组为空 |
| `compaction-smoke.mjs` | 12组通过，25次普通和21次摘要请求；含15%输出预算、触顶缩短、备用、停止与原文保留 |
| `token-saver-smoke.mjs` | 8组通过，13次普通和2次摘要请求 |
| `agent-selection-smoke.mjs` | 9组、8请求通过；角色资格与独立子模型配置保留 |
| `approval-recovery-smoke.mjs` | 6组共18轮通过；漏事件、迟到/旧回执和拒绝不落盘 |
| `v126-workbench-smoke.mjs` | 15组通过，42次普通和7次记忆请求；实际worker并发峰值2，错误数组为空 |
| `document-authoring-smoke.mjs` | 7组通过，16次普通请求、辅助请求0；真实DOCX/PPTX/PDF制作回读、覆盖保护和审批拒绝 |
| `model-retry-smoke.mjs` | 10组通过，25次普通、2次child和5次memory请求 |
| `desktop-smoke.mjs` | 21项通过；含真实受保护写入、浏览器隔离、删除运行会话及英文无漏译 |

新增能力专项实际核对第3000/4000行分页、reasoning/compaction加密项重放、commentary后的继续请求；真实Node进程先输出READY，再经stdin接收并输出`INPUT:HELLO`；浏览器PNG字节进入下一次Responses请求；实际child排队后由parent执行并返回`RELAY_VERIFIED`。证据位于`.impeccable/review/v130-harness-capabilities/`，`report.json`记录17次请求，`wire-fixture.json`仅含合成夹具；`browser-model-input.png`与`desktop-browser.png`已查看实际像素。

本轮文档作者证据位于`.impeccable/review/v130-document-authoring-1794192887296/`。两页PDF的真实渲染PNG已查看，文字、表格、图片及分页正常；DOCX语义预览不是Microsoft Word版式渲染，不将其作为Word视觉验收。通用桌面更新检查只读到服务器1.2.9，本地1.3.0正确显示current，未写云SQL。

### 本轮真实原生隔离

在保存并恢复原环境变量后，以`MINGSHEN_NATIVE_E2E=1`运行：

```powershell
pnpm.cmd --filter @mingshen/desktop exec vitest run src/main/workspace/native-sandbox-live.test.ts src/main/tools/persistent-native-command-live.test.ts --no-file-parallelism --testTimeout 120000
```

结果为2文件4项通过，68.12秒。其中2项执行真实MXC流程，另2项为基础单元检查；它们与全量套件部分重合，不把4项直接加到1009上。真实流程覆盖工作区文件及记忆保护、外部路径/网络拒绝、持续stdin和取消清理；未因此声称真实Docker持续命令通过。

### 失败修正与交付边界

- 最初回归的旧夹具缺少新增ToolRegistry生命周期、图像模态和合法UUID，已补齐后完整重跑；失败轮次不计为通过。
- 全量后仅对`model-stream.ts`做一处无行为变化的调用换行格式整理；收尾再次生产构建通过，未把纯格式后的构建写成新一轮全量测试。
- `tool-rounds.test.ts`的完整750轮及执行次数断言保留。旧20秒单测试上限两次超时后明确改为120秒；这避免旧时限误失败，不是性能改善证明。端点URL/SHA改为每次请求构建只算一次，未量化耗时收益。
- 新桌面夹具改为等待preload就绪及引导结束，关闭无关自动记忆，并等待真实进程READY后再输入、有界轮询；保留产品断言。最初PowerShell JSON解析器拒绝上游`typesMap.json`，随后Node对全部30份JSON实际解析通过，未修改上游文件。
- 持续命令为pipe，不支持完整PTY/TTY专用程序，也不保证回收主动脱离父进程的任意daemon。未确认的清理保留lease和写入屏障；已关闭句柄的cleanup失败不自动重试，恢复可能需要重启，人工清屏障不能证明进程已停止。
- 真实付费模型语义质量、完整Token Saver开关A/B、供应商内部路由与总账单、全部网关和Windows矩阵尚未验收。合成基线通过及本地SSE请求验证不能替代上述结果。
- 本轮没有生成/安装正式NSIS或ZIP、执行云SQL、提交/推送Git；BrowserDo/Embiody按既有约定免真实测试。实验入口为`.\run-experimental.cmd`；后续修改源码须先重新`pnpm build`。

## 2026-11-09 模型设置与离线记忆补充

本节对应新模型预填、K/M 数值输入、已保存供应商编辑及 TencentDB 记忆完全离线维护。仍为1.3.0，保留schema7、永久迁移、政策修订号`2026-11-04.3`、原子图标及此前未提交实现。前节1009项和九个桌面专项是前一轮证据，不视为本轮已重跑。

本轮主要行为：

- 新模型草稿首次匹配字面前缀`gpt-6`（含`gpt-6.1`）或`deepseek-`时，按用户指定预填上下文、输出、模态和思考等级；首次后不因改ID覆盖用户设置，已有模型不自动覆盖。GPT新模型计费勾选只在显式切换时改上下文200000/1000000，保留输出值；不是官方规格或实际计费检测。
- 上下文/输出支持大小写K/M十进制单位，精确展开为安全正整数。非法单位、零、非整数或溢出保留草稿，显示双语错误并聚焦，禁止保存。
- 供应商名称、Base URL和协议可原位编辑，保持Key、鉴权、模型、会话和历史引用；活动任务期间禁止端点/协议改变。缓存不兼容时恢复auto/5m，连接改变后只清该供应商会话的旧上下文校准；与连接/缓存更新同一事务回滚，保留压缩摘要和累计用量。
- TencentDB使用确定性的本地摘录/精确去重适配器，保留固定v2.0.3上游质量筛选、FTS候选召回、冲突流水线、writer和检索核心。自动只新增episodic，不覆写不同事实或已确认偏好；不声称具备上游LLM语义抽取/合并的等同质量。
- TencentDB维护不获取Key、不请求辅助模型、不联网，取消旧30秒模型超时；真实新增数/现有条数与零新增中性提示独立显示，本地写入失败不使主任务失败。原生Memory仍走既有摘要，正常聊天仍可包含偏好与召回片段。
- 快照最终替换前再次检查原文件hash、开关和取消信号，覆盖提交I/O期间停止/外部编辑的竞态；2000条/2MiB、writer lock、手动revision、二选一和只读child边界保留。

已执行的定向与静态检查：

| 检查 | 实际结果 |
| --- | --- |
| 六文件定向Vitest，串行 | 142项通过，17.87秒 |
| `pnpm.cmd typecheck` | Node/Web TypeScript通过 |
| `pnpm.cmd lint` | Biome284文件通过 |

六文件为`model-settings-input`、`provider-update`、`provider-prompt-caching`、`tencent-memory-service`、`decision-memory-runtime`及`memory-routing`；覆盖本地中文/英文FTS、零网络调用、精确去重/不改快照字节、数字和版本差异、取消/禁用/外部编辑、写入上限、损坏和目录链接，以及真实ChatService无额外Key/模型请求。

首次定向140项中的目录链接测试在Windows清理junction时超时/EBUSY；改为`unlink`只删除测试链接后，保留链接路径拒绝和外部哨兵不变断言。随后增加两项提交I/O竞态回归，以上142项是修正后的完整定向重跑，不把首次失败计为通过。

本轮不使用正常用户数据库、Key或剪贴板，不调用付费模型，不生成正式NSIS/ZIP或执行云SQL。

### 本次最终检查

以下均为上述修改完成后的实际运行，Windows测试、构建和GUI顺序执行。真实Electron使用独立测试profile、临时项目和本地SSE；普通桌面更新检查只读当前公开版本1.2.9，本地1.3.0显示current，没有改发布数据。

| 检查 | 实际结果 |
| --- | --- |
| `pnpm.cmd --filter @mingshen/desktop exec vitest run --no-file-parallelism` | 107文件通过、4文件环境跳过；1110项通过、10项环境跳过，179.83秒；未另加全局测试超时 |
| `pnpm.cmd typecheck` / `pnpm.cmd lint` | Node/Web TypeScript、Biome284文件通过 |
| `pnpm.cmd build` | 上游25个模块源哈希校验及TencentDB离线资源生成通过；main101 / preload3 / renderer2219模块通过 |
| `.\package-win.cmd --check` | 33项必需资源、生产依赖、源/运行时哈希及1.3.0通过；未制作安装包 |
| 七个Node测试文件 | 45项通过：文档运行时闭包、打包路径/复制、原生复制、实验图标、TencentDB资源及合成任务基线 |
| `pnpm.cmd audit --prod` | 无已知生产依赖漏洞 |
| Impeccable detector | ProviderSetup、ProjectDiarySettings和workbench.css均无发现；另查看真实截图实际像素 |
| 脚本/数据语法 | 68个JavaScript、6个PowerShell脚本语法通过，30个JSON解析通过 |
| 收尾核对 | diff空白检查、26个交接/验证本地链接、三个1.3.0版本入口、政策修订号及源/资源NOTICE一致性通过 |

本次真实桌面回归：

| 脚本 | 实际结果 |
| --- | --- |
| `model-provider-settings-smoke.mjs` | 8组、4次普通请求通过；手动/发现模型预填、GPT显式开关、用户修改保留、K/M精确保存、非法值拒绝、连接三字段编辑及活动请求保护、实际协议请求路由、原会话重启后继续鉴权 |
| `tencent-memory-smoke.mjs` | 10组通过；7次主会话、2次child请求，辅助记忆请求0、原生摘要0；真实新增记录、去重字节不变、已确认偏好保护、项目二选一、child只读检索、双编辑草稿/外部冲突、开关/重启及文件/终端回归 |
| `project-memory-chain-smoke.mjs` | 7组通过；7次普通、3次原生摘要请求，原生Memory行为保留 |
| `provider-cache-smoke.mjs` | 10组、16次普通请求通过；缓存保存/协议、模型体系、wire及重启回归 |
| `desktop-smoke.mjs` | 21项通过；设置导航、内嵌手册/隐私、真实审批/原生隔离写文件、流式/失败脱敏、浏览器隔离和删除运行会话，英文无漏译 |

模型/供应商截图为`.impeccable/review/v130-model-provider-{zh|en}-{day|night}.png`四张；Tencent设置仍沿用脚本历史前缀`v129-tencent-memory-{zh|en}-{day|night}.png`，图内实际版本为1.3.0，本次已重新生成。已查看四张模型/连接截图及中夜/英日Tencent设置截图，文字、输入、勾选、按钮和JSON编辑器在1040×680可读；四种语言主题组合同时完成DOM无横向溢出检查。截图及运行夹具为合成测试内容，不是用户记忆库或聊天。

Tencent首次桌面运行在已通过六组后，重启时过早访问Electron dialog测试接口失败；脚本改为等待preload就绪后再挂接目录选择夹具，并阻止本地模型/更新RPC夹具之外的网络请求。随后完整重跑10组通过，没有修改产品来绕过断言。首次失败不计入通过。

### 本次交付边界

- 实验out已重建，可从根目录`.\run-experimental.cmd`运行。此入口有out时不自动重新构建，之后改源码须先`pnpm build`。
- GPT/DeepSeek预填是用户指定的可编辑UX默认值，兼容性仍取决于所选网关及真实模型能力；没有用付费模型验证这些参数的供应商支持情况。
- Tencent是保留上游本地核心、用本地规则提供候选与精确去重的适配，不具备上游LLM语义抽取/合并的等同质量，不宣称完整L0–L3或语义向量库。无新增或重复内容诚实返回0，不以填充记录证明质量。
- 普通聊天仍可把已使用的偏好/摘录发到配置的供应商；离线记忆维护与离线模型推理不同。2000条/2MiB上限、崩溃残留writer lock需要核实后处理等既有边界保留。
- 本轮没有正式安装/升级/卸载验收、真实付费语义评测、全网关/Windows矩阵或真实Docker验收；4文件10项环境跳过不计通过。BrowserDo/Embiody仍按既有约定免真实测试。
- 没有生成安装包、执行云SQL、修改发布哈希、提交或推送Git；文档及版本入口保持1.3.0。

## 2026-11-09 光轨界面正式接入

本节只记录本轮第二界面风格的实际结果。应用仍为1.3.0，schema7、永久迁移、政策修订号`2026-11-04.3`、原子图标和原业务流程不变；前节1110项及五个桌面专项属于上一轮。

本轮实现：

- 默认“简约”保留，新增“光轨 / Light Trails”，共享会话、工具、权限、项目数据和三种工作布局。全局风格存入现有`ui.preferences`，旧配置默认简约，旧保存请求遗漏风格字段时保留已存值。
- 选择风格自动保存，当前`activeStyle`固定到下一次重载或启动；日夜与语言保持即时切换。串行保存队列等待最新值，错误可见并保留待保存值。
- 设置中的“重载并应用”在保存前后检查草稿/附件、文件及历史消息编辑；主进程拒绝全部活跃/准备发送/压缩/待审批或回答的任务、退出清理和更新交接期间的重载。不会替用户停止任务。
- 光轨覆盖仅在根风格属性下生效，保留连续工作台与真实响应式计算；新增日夜色板、金属边缘、细流光、真实运行信号、输入框及设置精修。正式应用和旧预览均不再放置大型本地记忆展示卡。
- 连续流光只用CSS transform/opacity，隐藏窗口暂停；系统减少动态效果或应用关闭时禁用。流式正文入场只改变transform，首帧不因opacity淡入变暗。
- README、DESIGN及双语内嵌USER_GUIDE/CHANGELOG同步，没有修改三协议正文、版本、依赖或模型逻辑。

### 静态、构建与打包预检

| 检查 | 本轮实际结果 |
| --- | --- |
| 完整串行Vitest，Node24.22.1 | 108文件通过/4文件环境跳过；1118项通过/10项环境跳过，148.72秒，退出0；未额外提高时限，命令见下 |
| `pnpm.cmd typecheck` | Node/Web TypeScript通过 |
| `pnpm.cmd lint` | Biome287文件通过 |
| `pnpm.cmd build` | TencentDB上游25个模块源哈希及离线资源生成通过；main102/preload3/renderer2221模块通过，包含最终流式首帧修正 |
| `.\package-win.cmd --check` | 33项资源、生产依赖、原生哈希及1.3.0通过；没有制作安装包 |
| 七个Node测试文件 | 45项通过；文件列表及命令与前节相同，本轮已实际重跑 |
| `pnpm.cmd audit --prod` | 无已知生产依赖漏洞 |
| Impeccable detector | `orbit.css`、`InterfaceStylePicker.tsx`返回`[]`，不是完整无障碍或性能认证 |
| 脚本与数据语法 | 69个JavaScript、6个PowerShell脚本语法通过，30个JSON解析通过 |
| diff空白 | `git -c core.autocrlf=false diff --check`通过 |

本机最终完整测试的准确调用（从仓库根目录）：

```powershell
Push-Location apps/desktop
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules/vitest/vitest.mjs' run --no-file-parallelism
Pop-Location
```

上面的Node为已安装Codex bundled v24.22.1，最终命令未加载诊断loader，也未修改测试、产品或超时。常规`pnpm.cmd`使用本机`D:\NodeJs\node.exe` v24.19.0时，完整串行曾出现107文件通过/1失败/4跳过、1117项通过/1失败/10跳过；失败定位为Tencent目录链接夹具的`fs.symlink(..., "junction")`迟迟不返回，之后清理EBUSY。单独同项仍可复现，且在worker最早阶段、产品模块加载前也出现；同版本独立Node进程创建正常。换v24.22.1后Tencent18项和上述完整套件均通过。这表明运行时/worker环境是相关条件，不把它定性为已证实的Node上游缺陷，也不将24.19.0失败轮次算作通过。

### 真实桌面验证

所有脚本顺序执行，使用独立临时profile、临时项目和本地SSE。没有读取正常用户数据库或Key，没有调用付费模型；通用桌面更新检查仅只读公开RPC，返回服务器1.2.9、本地1.3.0为current。

| 脚本 | 最终实际结果 |
| --- | --- |
| `node scripts/interface-style-smoke.mjs` | 17组通过，36张截图，两次真实启动、两次本地SSE请求、renderer异常0 |
| `node scripts/settings-focus-smoke.mjs` | 10组通过；连续中英输入、选区/焦点/IME、供应商/Key/模型保存及10份内嵌文档版本 |
| `node scripts/chat-scroll-smoke.mjs` | 19项通过，160段输出；真实滚轮/键盘、上滑暂停、单按钮恢复、完成不跳位 |
| `node scripts/desktop-smoke.mjs` | 21项通过；引导、全部设置导航、审批/原生隔离写入、流式/失败脱敏、浏览器隔离及删除活动会话，英文漏译数组为空 |

光轨专项17组包含：

- 默认/旧配置、待应用与撤销、真实IPC重载和干净退出后重启；旧客户端保存不丢风格字段。
- 简约与光轨往返后，会话、供应商、模型、权限和原始消息精确不变；没有大型记忆卡。
- 未发送草稿/附件、未保存文件及历史消息编辑阻止重载；取消历史编辑不改变已存原文。
- 运行中重载拒绝且原任务正常完成；真实窗口hide/show对应根visibility属性与动画paused/running。
- 三布局共享组件身份及草稿，双语与日夜矩阵、紧凑设置、800/1040/1440/1920宽度、1.25/2x CDP像素缩放。
- 应用Off与系统reduced-motion无运行动画；首个含正文动画帧中消息、正文及祖先的有效opacity均为1。

截图位于`.impeccable/review/interface-style-*.png`，其中`failure.png`是早期夹具失败证据，不计入最终36张成功截图。主代理及只读审查查看了最新夜间空会话、流式首帧和紧凑英文日间设置的实际像素；此前还检查代码/协作和日夜矩阵。未见当前审查范围的文字失读、控件重叠、截断或大型记忆卡。

### 失败修正及边界

- 初轮光轨夹具等待设置入场尚未结束即操作，另一次在导航时读取尚未存在的`documentElement`；修正等待及空值检查后完整重跑，不把失败轮次计为通过。
- 截图复查发现流式正文opacity淡入造成首帧短暂偏暗，改为仅transform，重建后最终17组验证覆盖该修正。
- 当前桌面和样式源码独立复核未发现阻塞；没有专门执行保存IPC失败注入、保存队列压力、屏幕阅读器或实际Windows系统DPI认证。CDP像素缩放不替代整机DPI矩阵。
- 动效性能依据实现方式与实际隐藏/减少动效检查，未作GPU、帧率、功耗或长期负载基准测试。
- 没有重跑所有历史GUI专项、真实付费模型、真实Docker或正式安装/升级/卸载；本轮未制作NSIS/ZIP、执行云SQL或Git发布。实验入口仍为`.\run-experimental.cmd`，后续改源码需先构建。

## 2026-11-09 运行信息展开与完整诊断

本节对应单行省略信息的展开/收起补充。版本仍为1.3.0，保留schema7、永久迁移、政策修订号`2026-11-04.3`、原子图标、简约/光轨及全部既有执行边界；前节1118项及光轨17组是上一轮结果，不当作本轮重跑。

### 实际修改

- 原生`details/summary`提供紧凑摘要、键盘操作及展开状态，正文按需挂载，保留原有换行、长行换行、独立滚动、选择与完整复制。
- 聊天活动、工具参数/命令/输出、重连与最终错误、上下文/输入错误、右侧审查/终端、子任务信息、MCP与运行集成配置接入详情；展开聊天信息暂停跟随，后续流式/完成不改变阅读位置或强制收起。
- 工具详情以来源消息区分单次调用，校验会话、名称、时间和用户轮次；重复callId不串接旧结果，歧义保留活动原文。历史记录在下一轮运行期间仍可展开，活动仅去重相同来源对象。宿主调用开始时间移至源消息保存之后，新增存储延迟回归。
- 参数JSON格式化保留词法内容；较大整数、重复键、顺序或转义表示会因解析变化时直接使用原文。重连、审批、压缩和MCP保留可用完整诊断及既有脱敏。项目检查活动保存全部诊断，模型反馈仍限80条。
- 输入区展开错误按可用高度滚动，任务带下仍可到达各段末尾及输入框；MCP错误Flex项允许收缩。子预览保持原容量边界，另有打开完整子会话入口。
- README、DESIGN和双语内嵌手册/更新日志同步，没有改变协议实质条款、模型参数、权限或源内容容量限制。

### 源码、构建与资源预检

| 检查 | 本轮最终实际结果 |
| --- | --- |
| 完整串行Vitest，Codex bundled Node24.22.1 | 109文件通过/4文件环境跳过；1145项通过/10项环境跳过，153.90秒，退出0 |
| 定向Vitest：ChatService、workbench runtime、activity details | 3文件51项通过，含宿主存储延迟、持久命令、复用ID及全量项目诊断；包含在上述全量中，不另相加 |
| `pnpm.cmd typecheck` / `pnpm.cmd lint` | Node/Web TypeScript、Biome290文件通过 |
| `pnpm.cmd build` | TencentDB上游25个模块哈希及离线资源生成通过；main102/preload3/renderer2223模块通过，包含最终MCP宽度修正 |
| `.\package-win.cmd --check` | 33项资源、生产依赖、源/运行时哈希及1.3.0通过；未制作安装包 |
| 最后UI修改后的Impeccable detector | ExpandableText、ChatView、WorkspacePanel、TaskWorkbench、SubagentOutput、McpSettings、RuntimeToolingSettings及workbench.css，8个目标返回`[]` |
| 脚本/收尾 | 三个信息展开/工作台smoke的Node语法、diff空白检查通过；三个版本入口1.3.0、政策修订号及schema7核对一致 |

最终完整测试从`apps/desktop`运行：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules/vitest/vitest.mjs' run --no-file-parallelism
```

本轮先完成1144项全量，收尾补上宿主调用保存延迟回归后重新执行完整套件，以上1145项才是最终结果；没有用定向通过替代最终全量。GUI、构建与完整测试顺序执行，沿用上一节已验证的bundled运行时，不增加全局测试时限。未修改依赖，本轮没有将上一节的生产审计或七文件Node结果冒充重新执行。

### 真实桌面验证

四个专项顺序执行，使用独立系统临时profile/项目、本地SSE或HTTP服务。命令由真实受管PowerShell执行；全内容复制仅在独立renderer截获，未读写系统剪贴板。

| 脚本 | 最终实际结果 |
| --- | --- |
| `scripts/information-disclosure-smoke.mjs` | 11组通过，6次本地请求，35张成功截图，renderer异常0 |
| `scripts/information-panels-smoke.mjs` | 10组通过，2次本地MCP请求，12张成功截图，renderer异常0 |
| `scripts/task-workbench-ui-smoke.mjs` | 6组通过，8次本地请求；两个真实worker、超过12k原文、加载错误/恢复及完整子会话入口 |
| `scripts/chat-scroll-smoke.mjs` | 19项通过，160段输出；自动跟随、鼠标/键盘暂停恢复和完成不跳位 |

运行信息专项实测：

- 长命令真实非零退出，完整参数、stdout/stderr、尾部及复制精确一致；运行中直接展开即暂停跟随，完成后保留同一展开节点。
- 下一轮重连期间可继续打开旧命令记录。真实503重试/恢复和永久403最终失败均保留完整本地HTTP正文、空行和末尾，详情复制等于持久化原文。
- 审查区的命令参数/输出、内部滚动和复制；Simple/Orbit × 中英文 × 日夜 × 800/1440宽度，展开/折叠不改消息内容。

面板专项实测真实终端命令/输出/退出码7、自定义工具完整源路径、LSP/Formatter命令与扩展列表；MCP返回超过4000字符的503，持久错误与测试结果一致，保留空行和尾部，假鉴权秘密已脱敏。自定义元数据只发现不执行，USERPROFILE/HOME固定在临时目录。800×600、8步展开任务带和同时打开两个错误时，正文末尾与输入框均可滚动到达。上下文失败和通知回复草稿错误为测试事件注入，不冒称真实压缩/回复后端失败。

工作台专项的真实子任务正文超过12k、低于40k，核对保存原文和独有首尾标记；预览明确截断，入口打开对应完整子会话。加载错误只注入临时`workbench:subagent-output`处理器，核对完整错误及复制后在`finally`还原，刷新恢复真实已保存输出。既有停止/重启/最新计划续跑、名称导航及英文紧凑布局继续通过。

截图位于`.impeccable/review/information-disclosure-*.png`、`information-panels-*.png`及`v130-child-preview-*.png`。已查看主聊天重连/报错、完整审查、MCP长错误、紧凑输入区和子会话代表图的实际像素；来源均为合成测试内容。独立数据与界面复核未发现本轮阻塞，不等同于全面可访问性认证。

### 失败修正与边界

- 首次面板专项暴露MCP Flex自动最小宽度问题，长摘要可撑至约47,000px；修复`min-width:0`及列内最大宽度后，完整10组重跑通过。
- 子会话导航最初用侧栏选中行断言，父组折叠时虽已正确导航仍失败；改核对独有源消息ID及原文首尾，随后完整6组通过，没有放宽导航要求。
- 截图中的`scrollIntoView`曾移动隐藏溢出祖先，改为只滚指定容器并断言外层未移动。光轨设置截图曾因窗口隐藏、入场动画停在透明首帧而全空白；截屏前置前窗口、等待可见和有限入场动画结束，增加设置视口/不透明断言，最后完整10组及代表图复核通过。失败截图不算视觉通过证据。
- 展开呈现实际保留的信息，不能恢复上游/旧记录/原工具与响应上限已经省略的内容；近期子输出预览仍有容量边界。保持脱敏，完整显示不意味着全部第三方自由文本已匿名化。
- 本轮没有用户DB/Key/剪贴板访问、付费请求、云SQL、正式安装包或Git提交/推送。没有重跑所有历史GUI、真实Docker、全Windows/DPI、屏幕阅读器或全部付费网关矩阵。

## 2026-11-09 光轨按预览独立重构

用户指出前次光轨只是原界面换肤，要求以已确认预览为准重构第二套界面。本节记录本轮独立结构的结果；前两节的光轨接入、运行信息展开历史验证不自动视为本轮通过。保留1.3.0、schema7、全部永久迁移、政策修订号`2026-11-04.3`、原水青原子图标、默认简约及既有数据与执行边界。

### 实际实现

- `App.tsx`与`orbit-workbench.css`建立独立光轨网格：56px工具轨、单独会话侧栏、面包屑标题、中央对话与输入框、同时存在的右上审查/文件/终端与右下任务/Agent、26px底部状态条。工具轨连接真实导航，窄窗上下两区作为同一抽屉开合。
- 审查区列出实际变更文件及所选文件的已保存diff，保留文件编辑、复制、Git、浏览器与命令停靠。任务区固定显示实际计划、Agent、项目计划库，计划页附真实子任务摘要与完整会话入口。
- 连续工具/思考记录组织为可分别展开的时间轴。`orbit-transcript.ts`跳过不可见的Responses状态及空元数据，保留正文、错误与附件边界，同一用户轮次避免重复Agent标头。标头包含真实身份、主/子角色与消息时间；权限、隔离与仅补丁详情在光轨输入框底栏。
- 项目布局键按风格隔离，光轨使用`@orbit:`前缀。原简约保存值保留，光轨默认侧栏/右区为228/360px；切换布局保留同一聊天、输入框和文件编辑器节点。
- 任务视图导航请求绑定目标会话，切换会话清理旧请求，工具轨状态跟随真实工作区标签。风格仍须重载或重启，已有任务/草稿保护继续保留；补上计划编辑的脏标记，未保存计划也拒绝重载。
- 两个风格选择缩略图分别反映各自布局。README、中英文手册/更新日志、AGENT和DESIGN及设计sidecar同步实际结构；没有恢复大型记忆展示卡或添加演示记录。

### 源码、构建与预检

| 检查 | 本轮最终实际结果 |
| --- | --- |
| 完整串行Vitest，Codex bundled Node24.22.1 | 110文件通过、4文件环境跳过；1155项通过、10项环境跳过，174.35秒，退出0 |
| `pnpm.cmd typecheck` | Node/Web TypeScript通过 |
| `pnpm.cmd lint` | Biome292文件通过，没有自动改写 |
| `pnpm.cmd build` | TencentDB固定上游25个模块源哈希及离线资源生成通过；main102/preload3/renderer2225模块通过 |
| `.\package-win.cmd --check` | 33项必需资源、生产依赖与1.3.0通过，没有制作安装包 |
| 五份相关smoke脚本语法 | 独立工作台、界面风格、运行信息、信息面板及子任务脚本的Node语法检查通过 |
| 版本与边界 | 根/桌面package及release仍为1.3.0，政策修订号`2026-11-04.3`，schema7不变 |

最终完整测试从`apps/desktop`运行，没有提高测试时限：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run --maxWorkers=1 --fileParallelism=false
```

新增布局隔离测试及9项执行记录分类测试包含在1155项内，不另相加。完整测试和GUI顺序执行。最后嵌入文档文字同步后重新构建，实验out已更新；没有把纯文档后的构建写成又一轮全套GUI。

### 真实桌面验证

所有GUI脚本串行执行，使用独立profile、临时项目与本地SSE/HTTP。命令、文件修改和worker由应用实际工具执行产生；复制只在测试renderer截获，未访问系统剪贴板。

| 脚本 | 本轮实际结果 |
| --- | --- |
| `scripts/orbit-workbench-smoke.mjs` | 9组通过；13次本地请求（含2次worker请求），21张截图，renderer异常0 |
| `scripts/interface-style-smoke.mjs` | 18组通过；37张截图，两次真实启动、两次本地SSE请求，renderer异常0 |
| `scripts/information-disclosure-smoke.mjs` | 11组通过；6次本地请求，35张截图，renderer异常0 |
| `scripts/information-panels-smoke.mjs` | 10组通过；2次本地MCP请求，12张截图，renderer异常0 |
| `scripts/task-workbench-ui-smoke.mjs` | 6组通过；8次本地请求，真实child超过12k原文、完整会话入口及预览错误恢复 |
| `scripts/chat-scroll-smoke.mjs` | 19项通过，160段输出；滚轮/键盘、跟随暂停恢复与完成后阅读位置 |
| `scripts/settings-focus-smoke.mjs` | 10组通过；连续输入、选区/焦点/IME、设置保存及10份内嵌文档版本 |
| `scripts/desktop-smoke.mjs` | 21项通过；引导、设置、审批/原生隔离写入、流式/错误脱敏、浏览器隔离及删除活动会话，英文漏译数组为空 |

独立结构专项实际验证两处文件变更、命令及完整尾部、3步计划、真实只读子任务，确认审查/任务同时显示；模式切换保持输入及编辑器身份/草稿，工具轨文件/终端/Agent/对话导航可用，第二会话不会重放第一会话的Agent导航请求。中英文与日夜切换不改保存的消息、计划、模型或权限；800/1040窄窗和1920/2559桌面均核对边界。切回简约后光轨结构消失，原数据保留，再切光轨可恢复。

风格专项新增真实计划编辑检查：创建已保存计划，界面修改后尝试应用简约，确认renderer未替换、光轨仍使用中、计划草稿和保存计划/消息精确不变；取消清除脏标记，无额外模型请求。既有消息/附件、文件及历史编辑保护、活动任务拒绝重载、进程重启、hide/show、减少动效及200%像素缩放继续通过。

运行信息专项保留完整长命令/参数/输出精确复制、原生Enter展开立即暂停跟随、运行到失败后同一展开节点、跨轮历史、真实503重连及403永久失败诊断。Simple/Orbit×中英文×日夜×800/1440宽度均核对闭合/展开、全文与越界。信息面板、子任务及滚动在本轮结构整合后完成；最后间距和计划草稿修正由上述运行信息、独立结构及18组风格专项覆盖。

### 实际截图与独立复核

工作台证据位于`.impeccable/review/orbit-rebuild-*.png`，包括空会话、运行、完成、完整命令、2559/1440变更与任务同屏、中英日夜、800/1040抽屉、终端、设置及恢复简约。主题与详情矩阵分别位于`interface-style-*.png`及`information-disclosure-*.png`；均为合成夹具数据，不是私人聊天。

主任务查看最终设置、2559/1440工作台、窄窗、日夜和完整报错等实际像素。独立视觉复核打开用户两张参考图及15张指定运行截图，先判`fix`，要求缩略图体现独立结构并消除溢出；同路径重采后重新打开全部15张，两项均判`resolved`，最终`disposition: ship`。此verdict只覆盖列出的两项修正，不冒充完整辅助技术认证。独立代码复核另发现计划草稿重载遗漏，修复后由新增真实界面回归确认。

本轮7个UI目标的Impeccable检查无主要发现，14项10/11px字号提示对应品牌副标题及状态/时间元数据，已交视觉复核按预览角色审阅，没有将它写成零提示。没有运行第二轮detector。只读资源来源扫描发现两张既有原子PNG缺嵌入元数据；本轮没有新生成/采购位图，DESIGN记录用户既定来源与路径，保留原图标字节及像素，不为补元数据修改受保护资产。

### 失败修正与交付边界

- 不可见的Responses状态曾打断执行分组，新增分类辅助函数及9项回归，正文/错误/附件继续作为可见边界。
- 运行信息完整矩阵最初暴露光轨用户消息操作栏负外边距导致4px横向溢出，修正为局部`margin-inline:0`；随后发现14px箭头旋转过程外接框约19.8px，摘要末端留4px后完整11组通过。保留越界断言、完整原文与动画，不用隐藏溢出来掩盖。
- 新结构下的旧夹具假设顶栏高度、上方任务带和面板入口，已改为核对实际光轨结构，简约旧断言保留。新会话经真实侧栏加号创建，滚动用真实CDP滚轮建立离底位置；没有降低消息、请求数、阅读位置或跨会话隔离断言。失败轮次不计通过。
- 本轮没有读取正常用户DB/Key/剪贴板、调用付费模型、执行云SQL、提交/推送Git或制作NSIS/ZIP。通用桌面仅只读公开更新RPC，服务器返回1.2.9，本地1.3.0显示current。
- 保留原输出容量、近期子预览上限和脱敏。展开只能展示实际保留内容，不能恢复上游已省略部分。未完成全Windows/DPI、屏幕阅读器、全部付费网关、真实Docker或正式安装/升级/卸载矩阵；4文件10项环境跳过不计通过。
- 实验入口仍为`.\run-experimental.cmd`，已有out时不自动构建；本轮out已经最终重建，后续源码修改仍须先`pnpm build`。

## 2026-11-09 光轨材质打磨与模型供应商标签

本节对应用户认可独立工作台后的继续打磨，以及主界面显示供应商的补充要求。保留既定光轨结构、默认简约、1.3.0、schema7、永久迁移、政策修订号`2026-11-04.3`、原子图标和业务执行边界。上一节完整1155项Vitest及其他历史专项不计作本轮重跑。

### 实际修改

- 标题栏和56px工具轨使用现有令牌派生的金属光边、暗边与局部反射，标题栏增加静态冰蓝细边；居中光轨标识配细线，工具轨选中态、会话与工作区标签增强层级。
- 输入框细化局部材质、上沿光线、右侧40px信号边和上下文分隔。标题栏/输入框光线行程分别为自身宽度100%/150%，仍只用CSS transform/opacity，遵循隐藏暂停、应用关闭与系统减少动态效果。
- 真实运行行驱动执行记录材质、节点及底部状态菱形，审批/提问/完成不伪装成运行。没有新增展示卡、虚构指标或演示任务进入产品。
- 主聊天的`ModelPicker`启用可选`inlineProvider`，中文显示`模型名（供应商名）`、英文显示`Model (Provider)`。无有效模型时只显示本地化选择提示；其余选择器默认保留原布局。
- 主控件按内容占宽，最大`min(360px, 100%)`；两段文字自然收缩、分别省略，供应商使用较轻辅助文字，完整title含供应商、模型名和模型ID。DOM及实际CDP可访问树保留完整模型/供应商名称，两枚14px图标不参与收缩。
- README、中英手册/更新日志、DESIGN及sidecar同步；保留Simple原始令牌、前五个示例和narrative。没有新增依赖、模型请求、权限或数据库迁移。

### 静态与构建

| 检查 | 本轮实际结果 |
| --- | --- |
| `pnpm.cmd typecheck` | Node/Web TypeScript通过 |
| `pnpm.cmd lint` | 最终Biome292文件通过，没有自动改写 |
| `pnpm.cmd build` | main102/preload3/renderer2225模块通过，固定TencentDB上游25模块源哈希与离线资源生成通过 |
| `.\package-win.cmd --check` | 33项资源、生产依赖及1.3.0通过，没有生成安装包 |
| Impeccable detector | ModelPicker、ChatView、workbench.css、orbit.css、orbit-workbench.css，5个目标一次返回`[]`；在最后删除供应商百分比上限前执行，未运行第二轮 |
| 文档与收尾 | DESIGN的YAML、sidecar JSON/schema2、8个正文节、10个示例通过；smoke语法、diff空白通过，无残留55%说明 |
| 保护项 | 根/桌面package及release为1.3.0，政策修订号与schema7不变；renderer/build两枚原子PNG的Git blob与原始字节相同 |

本轮未重跑完整Vitest，不把上一节110文件/1155项当作本节验证结果。最后生产构建包含最新供应商宽度修正和已同步的中英内嵌文档；交接记录更新后再次重建实验out，不将纯记录后的构建描述成又一次GUI回归。

### 真实桌面结果

GUI顺序执行，使用独立系统临时profile、临时工作目录和仅本地Responses SSE。两处文件修改、完整命令输出、计划及只读worker均由应用实际工具执行产生，没有付费模型或正常用户数据访问。

| 脚本 | 本轮结果及时间范围 |
| --- | --- |
| `scripts/orbit-workbench-smoke.mjs` | 最终12组通过，30张截图，13次本地请求含2次worker，renderer异常0；覆盖最后名称宽度与图标修正 |
| `scripts/interface-style-smoke.mjs` | 本轮前段18组通过，37张截图，两次启动/两次本地请求，renderer异常0；先于最后名称宽度修正，未在其后重复执行 |

最终光轨专项以Codex bundled Node24.22.1从仓库根目录运行：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/orbit-workbench-smoke.mjs
```

12组保留原独立结构、完整命令展开、真实变更审查/任务同屏、布局切换的组件及草稿身份、跨会话导航隔离、中英日夜与800/1040/1920/2559边界、设置及简约往返。新增三个供应商显示分组：

- 通过实际菜单选择两个供应商下相同显示名称的模型，确认括号后缀随供应商改变，保存的供应商身份正确。
- 简约/光轨×中文/英文×日间/夜间×1440/800窗口，先选普通模型断言模型和供应商均不截断；再选长名称验证分段省略、完整title与实际CDP AX名称、箭头尺寸及输入区边界。只读AX检查不等于完整辅助技术认证。
- 仅移除临时选中模型，确认简约中英显示选择提示且没有孤立括号；恢复原模型后消息/计划保持相同，选择过程不额外发起模型请求。

18组风格专项在本轮前段复验待应用/重载/重启、未发送草稿与附件、文件/历史/计划编辑保护、运行中拒绝重载、旧保存字段兼容、三布局身份、真实hide/show、关闭/减少动效与像素缩放。最后只删除名称百分比上限和固定图标收缩，不改变这些业务保护。

### 截图与独立复核

全部截图位于`.impeccable/review/orbit-rebuild-*.png`，由最终运行覆盖相同路径，不能当作未改变的before图。最新主界面为`orbit-rebuild-polished-provider-zh-night-1440.png`；长名称矩阵为`orbit-rebuild-model-provider-long-{orbit,simple}-{zh-CN,en}-{night,day}-compact.png`，其余为运行/完成、日夜、宽屏及窄窗等实际应用截图，内容均是合成测试数据。

主任务查看最终中文夜间主界面、中文日间、光轨英文夜间长名和简约英文日间长名等实际像素。独立复核先打开用户参考及16张指定截图，`disposition: fix`唯一指出普通供应商在可容纳时仍被55%上限提前省略。删除上限、同步DESIGN及sidecar并完整重跑12组后，复核重新打开同一16张原路径截图，判该项`resolved`、未发现此次修正引入的回归，最终`disposition: ship`。该verdict仅覆盖所评分修正，不宣称整个界面或完整可访问性认证。文档另经独立只读审查，无对应实现差异。

### 发现、修正与边界

- 最初长名夹具供应商超出服务80字符限制，改为79字符仍保留长名测试；没有放宽产品校验。随后发现长名可把下拉箭头压到约5px，增加触发器SVG的`flex-shrink:0`并重跑。
- 百分比上限会在控件仍有空间时截断普通供应商，删除后加强普通名完整显示断言并再次完整12组通过。最终截图与结果均来自修正后的运行，失败轮次不计通过。
- 模型菜单选择使用实际DOM点击；本轮没有重新认证窄窗菜单的完整指针/键盘操作。无选中模型只覆盖简约中英，Server图标不另作独立像素测量；其防收缩由相同局部CSS实现。
- 没有读取正常用户DB/Key或系统剪贴板，没有付费请求、云SQL、Git提交/推送或NSIS/ZIP。保持工具输出、响应容量及已有脱敏边界，没有完整Windows/DPI、屏幕阅读器、GPU/帧率、真实Docker或安装/升级/卸载验收。
- 实验out已更新；正常退出旧进程后从`.\run-experimental.cmd`启动。已有out时该入口不会自动构建，后续源码修改仍先执行`pnpm build`。

## 2026-11-10 实验启动图标损坏恢复

用户报告Node24.19.0下，`prepare-experimental-runtime.cjs`进入resedit的ICO解析器时触发 `RangeError: Offset is outside the bounds of the DataView`。实际仓库ICO为0字节，两个既定原子PNG及原版Electron完整；启动脚本仅判断存在，无法识别空文件。旧生成器直接创建目标，会先截断文件，但隔离复现仍能正常生成37498字节ICO，本轮未确定具体清空原因，不能据此认定Node故障。

### 修改

- `windows-icon.cjs`提供共享ICO头/目录/范围校验，另检查PNG尺寸、完整chunk边界、CRC与IDAT/IEND，或未压缩BITMAPINFOHEADER的尺寸、像素深度、调色板/像素/掩码基本范围；防止resedit原样接受未知原始载荷。
- 准备脚本对缺失、空白及结构损坏ICO从相邻同名PNG恢复，恢复后再解析及校验缓存；自定义图标不回写默认ICO。失败保留实验EXE和marker，并给出路径及生成器错误。
- PowerShell生成器沿用同一绘制算法与16/20/24/32/48/64/128/256尺寸，在内存完成后写同目录唯一临时文件，以Replace/Move替换；解码失败或目标独占锁时保留旧文件并清理自身临时文件。Windows PowerShell5.1的Replace空备份路径使用 `NullString.Value`，已实际覆盖替换分支。
- 启动BAT统一使用准备脚本，不再只在ICO缺失时单独生成；源与afterPack打包检查共用新校验。README与AGENT同步，版本仍为1.3.0，无依赖、schema或政策变更。

### 本轮实际验证

所有Node命令使用用户同一 `D:\NodeJs\node.exe` v24.19.0，生成测试调用本机 `powershell.exe`；各测试使用独立临时图标路径，不破坏真实源资源。

```powershell
& 'D:\NodeJs\node.exe' --test scripts/prepare-experimental-runtime.test.cjs scripts/generate-icon.test.cjs scripts/windows-icon.test.cjs
& 'D:\NodeJs\node.exe' --test scripts/package-paths.test.cjs scripts/package-runtime-copy.test.cjs scripts/package-native-copy.test.cjs scripts/package-document-runtime.test.cjs scripts/tencent-memory-package.test.cjs
& 'D:\NodeJs\node.exe' scripts/prepare-experimental-runtime.cjs
.\package-win.cmd --check
& 'D:\NodeJs\node.exe' scripts/taskbar-restart-smoke.mjs
```

| 检查 | 本轮实际结果 |
| --- | --- |
| 三份图标专项 | 17项通过、0失败/跳过，26.307秒；缺失/空文件/目录截断/帧截断/无效载荷恢复，缓存不重写、源与默认ICO保护、PNG失败及独占锁保护、PNG/DIB结构校验 |
| 五份既有打包测试 | 35项通过、0失败/跳过，2.497秒；包含Windows原生复制、构建目录边界、有限重试、依赖闭包及TencentDB资源保护 |
| 真实图标恢复 | 实际准备入口退出0；ICO为37498字节/8帧，SHA-256为 `6b9fae1ae52dc5d28543e02ae66d46af1d2c4afce35190dd9596d0dab9eda8b6`；重复调用 `changed:false`，ICO与实验EXE时间戳不变 |
| 用户打包预检入口 | 33资源、生产依赖及1.3.0通过，没有构建安装包 |
| Windows图标与重启 | 大小图标与ICO一致，两次干净启动均为 `com.mingshen.harness.experimental.desktop`，内嵌图标路径和原生图标句柄完整 |
| 实际启动BAT | 独立profile、`MSH_DEBUG_PORT=9342`，完整 `run-experimental.cmd` 退出0并打开真实窗口，CDP确认preload就绪，经 `desktopAction('quit')` 正常退出 |

任务栏检查证据位于 `.tmp-taskbar-restart-1794271230153`；完整BAT隔离profile为 `%TEMP%\mingshen-launcher-recovery-72lWv6`。本轮未读取正常用户数据库、凭据或剪贴板，没有模型请求、云SQL、Git提交/推送、解包或NSIS/ZIP。

ICO最初写入实际目录前先在独立目标验证新增与替换；首次替换暴露PowerShell5.1空路径绑定问题，修正后重测通过，不将失败尝试计为通过。只读复核另发现4字节零载荷可绕过原先仅范围检查，补充图像验证及对应回归后才执行上述最终17项。未修改前端源码、重建out或重跑完整Vitest，不沿用上一节UI测试数字作为本轮证据；不承诺任意断电、恶意构造图像或全部Windows/文件系统故障矩阵均已认证。

## 2026-11-10 Windows ASAR 文档依赖校验修复

用户完整日志显示图标生成、原生运行时、生产构建、33项预检和Electron复制均通过，afterPack报 `Missing packaged document dependency: docx`。读取失败缓存`windows-1.3.0-68DQwx`和`windows-1.3.0-BGcAp0`确认，ASAR中已有`node_modules/docx/package.json`和运行入口；相同路径以`/`传给本机`@electron/asar`的extractFile会失败，改为Windows分隔符则成功。

`scripts/check-package.cjs`现仅在ASAR读取边界转换为本机路径，文件索引及归档依赖路径仍为POSIX。缺包负例发现另一真实问题：旧候选会返回前导`/`，上溯到根路径后无法终止。候选使用POSIX join，明确识别根node_modules并终止不再缩短的父路径；保留版本、入口及递归依赖校验。

旧测试使用接受POSIX路径的Map假ASAR，同时把包含完整源依赖的目录当作unpacked，实际ASAR读取全部失败也能通过。新6项文档测试使用真实归档与分离的source/`.unpacked`，覆盖纯ASAR、混合解包、缺jszip、缺docx入口与源码闭包；创建归档后等待写流完成再读取/清理。

### 实际命令与结果

Node使用用户相同的`D:\NodeJs\node.exe` v24.19.0，pnpm入口同用户日志。

```powershell
node --test --test-concurrency=1 scripts/package-document-runtime.test.cjs scripts/package-paths.test.cjs scripts/package-runtime-copy.test.cjs scripts/package-native-copy.test.cjs scripts/tencent-memory-package.test.cjs scripts/windows-icon.test.cjs scripts/generate-icon.test.cjs scripts/prepare-experimental-runtime.test.cjs
.\package-win.cmd --dir
node --check scripts/check-package.cjs
node --check scripts/package-document-runtime.test.cjs
git diff --check
```

- 8份Node测试最终55项通过、0失败/跳过，26.119秒；文档测试6项全部通过，真实缺包和缺入口均明确拒绝。
- 对两份旧失败缓存运行完整afterPack均通过，17个文档运行依赖从实际ASAR及其解包目录读取。
- 第一次用户入口`--dir`退出0，生产构建main102/preload3/renderer2225、33资源/生产依赖预检及完整afterPack均通过，输出`%LOCALAPPDATA%\MingshenHarness\BuildCache\windows-1.3.0-c0drW0\output\win-unpacked\MingshenHarness.exe`。该次在缺包根循环修正之前，最终修正另由上述55项回归覆盖。
- 根循环修正后，同一个`.\package-win.cmd --dir`再次完整退出0，构建、预检与真实afterPack全部通过；最终解包程序为`%LOCALAPPDATA%\MingshenHarness\BuildCache\windows-1.3.0-X1lBs3\output\win-unpacked\MingshenHarness.exe`。
- 两脚本语法与diff空白检查通过。独立只读复核未发现本次补丁的阻塞问题，不将其扩大为全产品认证。

最初两轮测试在缺包负例中持续循环，分别中止本次测试worker；隔离调试器暂停确认栈位于`packagedPackagePath`，不是将其归因于Node或删除文件。修复后才取得最终55项结果，失败和中止不计通过。归档等待写流完成属于夹具收尾保护，不是已证实的此次循环根因。

版本1.3.0、schema7、政策修订号及品牌源PNG不变；保留全部原有未提交工作，没有修改依赖、lockfile、系统安全配置或正常用户数据。未生成NSIS/ZIP、执行安装/升级/卸载、桌面smoke、完整Vitest、云SQL或Git发布；本轮通过范围为打包脚本、资源预检与解包构建。正式安装包仍由用户运行根目录`.\package-win.cmd`生成，NSIS编译和安装流程不由解包结果替代。

## 2026-11-10 工作区记忆模型配置与 TencentDB 语义分析

本轮对应用户要求：设置 → 项目指令与信任手动选择工作区，按工作区选择原生/TencentDB、记忆分析模型及备用；未配主分析模型使用当前主对话实际模型。TencentDB 使用已固定上游的通用语义提取与冲突流程，移除直接保存助手回答的规则适配器。用户此实现请求取代此前只调研的范围。

### 实现与数据边界

- 后端及主备模型沿用本地应用setting，引用`ModelConfig.id`，无需会话即可配置；子任务及关联worktree解析到顶层记忆归属。相关任务和维护忙碌时拒绝保存，未保存配置与记忆正文草稿均保护。
- 显式切换只启用所选后端，保留原生及TencentDB两个目录，不改名、删除、迁移或合并。旧冲突须明确保存后端，不静默处理。
- TencentDB v2.0.3 / `084bed45cad6bb7f877455082cee82835d65671a`的原始模块与哈希保持。分析模型运行通用chat提取/冲突提示，输出`persona/episodic/instruction`和`store/skip/update/merge`，通过严格来源/目标/字段校验后原子提交；已确认persona/instruction受保护，自动分析元数据保留。
- 主模型失败或结构无效时，备用从原始输入重做完整提取及冲突操作；有效空结果不切备用，不回退为原文摘录。双失败只报告记忆维护失败，不改变已完成任务结果。每次尝试180秒、无工具、最多8192输出tokens并记入`memory`用量。
- 当前完成轮最多20条用户/助手文字、合计32000字符、每条8000字符，去已知凭据及think块，不直接附带工具、附件、隐藏推理或旧轮。分析和有界候选记忆可发送给独立/备用供应商，正常鉴权及传输重试保持；失败尝试另记`memory.analysis`的主备/attempt/模型来源，不记录完整提示。
- 临时FTS及中间结果仅内存维护，取消、配置变化、版本冲突或校验失败保留权威JSONL。上游吞错store-all回退不能写入磁盘，产品存储回退仍禁用；2000条/2MiB上限、子任务只读与原生摘要规则保留。
- 升级和切换不批量清理或重写历史摘录；后续语义维护仍可更新或合并未受保护旧记录，用户可编辑/删除。README、SECURITY、双语手册/日志/隐私及NOTICE已同步，并澄清原生规则捕获与TencentDB语义分析差异。

### 源码与资源验证

Vitest使用Codex bundled Node24.22.1，在`apps/desktop`执行，保持原测试时限：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run --maxWorkers=1 --fileParallelism=false
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run src/main/chat/decision-memory-runtime.test.ts --maxWorkers=1 --fileParallelism=false
```

仓库根入口：

```powershell
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
.\package-win.cmd --check
node --test scripts/tencent-memory-package.test.cjs
node --check scripts/workspace-memory-settings-smoke.mjs
node --check scripts/tencent-memory-smoke.mjs
git diff --check
```

| 检查 | 本轮结果及时间范围 |
| --- | --- |
| 完整串行Vitest | 110文件通过/4文件环境跳过，1203项通过/10项环境跳过，176.91秒，退出0；先于最后日志及保存栏修正 |
| 后端定向 | service38、runtime29、routing14，合计81项通过；配置28项另已通过，不与全量重复相加 |
| 日志修正后runtime | 29项重跑通过，14.91秒；现有transport/malformed主失败备用成功用例追加脱敏日志上下文断言 |
| Node/Web TypeScript | 通过 |
| Biome | 最终292文件通过，无自动改写 |
| 生产构建 | main102/preload3/renderer2225通过，25个固定上游源模块哈希验证通过；最终设置GUI使用包含保存栏修正的构建 |
| 用户预检 | 33资源、生产依赖及版本1.3.0通过，不生成安装包 |
| TencentDB资源Node测试 | 19项通过；上游来源、哈希、许可、ESM闭包及适配器保护 |
| 静态收尾 | 两smoke语法、diff空白、版本/政策/schema及受保护原子PNG核对通过 |

最后只同步手册标签、旧摘录边界和交接说明后再重建实验out；不把纯文档后的构建当作额外一次GUI回归。

### 真实 Electron 验证

GUI顺序执行，使用独立临时profile/工作目录、本地Responses SSE和无效fixture凭据；未使用正常用户数据库或真实付费模型。命令均在仓库根目录：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/workspace-memory-settings-smoke.mjs
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/tencent-memory-smoke.mjs
```

| 脚本 | 最终实际结果 |
| --- | --- |
| 新workspace-memory-settings-smoke | 8组通过，2次启动，5次chat/7次extract/3次dedup，renderer异常0；在最后保存栏修正后完整重跑 |
| 既有tencent-memory-smoke | 10组通过，2次启动，主chat7/子chat2、memory6（extract4/dedup2）、原生摘要0，renderer异常0；在最后纯日志及局部保存栏修正前执行 |

新8组覆盖：无会话选目录及自己的项目指令；取消关闭/Esc/工作区切换保留配置草稿；保存Tencent保留每个原生文件；缺省真实主模型分析并使用真实消息ID而非原文；模型菜单选择和重启持久化；主冲突失败备用从相同来源完整重做且不提交主候选；有效空和双无效输出保留快照字节及完成结果；记忆草稿切换保护和两后端正确编辑器；双风格双语日夜800/1440及1040顶部几何与命中检查。

既有10组保留项目初选/继承、真实IPC冲突拒绝、上游提取/筛选/FTS与确认偏好保护、去重及空结果、真实spawn只读child检索和等待、JSON独立草稿及外改版本冲突、关闭/重启、UTF-16 LE/BE及文件列举、真实PowerShell中文及退出码颜色、四种语言/主题组合。

### 视觉收尾与失败修正

- `.impeccable/review/tencent-analysis-{simple|orbit}-{zh|en}-{night|day}-{800|1440}.png`为16个配置状态，另4张`v130-tencent-memory-workspace-top-{zh|en}-{day|night}.png`为1040×680首屏。最终同路径重采，主流程/UI代理已查看实际像素；证据均为合成夹具。
- 首次独立截图复核发现`approval-panel__actions`继承全局sticky，保存条遮挡备用选择器。改为独立普通流`project-memory-actions`，保留全局审批规则；新增20状态`position:static`、保存区在全部字段/说明之后的几何断言，4首屏五关键控件完整可见且`elementFromPoint`无遮挡，修正后完整8组通过。
- 通用fresh代理代替专门reviewer进行独立复审，逐张重新打开4首屏和4张800代表图，P2 resolved、最终disposition ship，仅覆盖本次遮挡及相关回归，不能扩大为完整可访问性认证。
- Impeccable context及5目标detector各仅一次；目标为ProjectMemorySettings、ProjectDiarySettings、SettingsDrawer、NewSessionDialog和styles.css。无主要发现，既有全局样式旧段提示保留，新增样式未新增对应提示；未因收尾重复detector或修复无关设计drift。
- 独立后端复核发现主失败备用成功漏记日志，已在每个可回退失败分支记录来源并扩展原回归；又修正文档“旧摘录永不改写”的绝对说法，明确正常语义更新/合并范围。
- 既有Tencent smoke的前两轮失败来自旧夹具焦点假设及过宽颜色选择器；夹具改为等待实际输入焦点、只取本次命令输出颜色，保留原语义写入、只读child、完整原文和版本断言。失败轮不计通过。最终设置smoke的保存栏修改是产品修复，不作为夹具豁免。

版本仍1.3.0、schema7、政策修订号`2026-11-04.3`及原子图标不变。不读取或改写正常用户DB/Key/记忆，不调用付费模型、不执行云SQL、不生成解包/NSIS/ZIP、不提交或推送Git。没有新增云端记忆服务、L0原始对话副本、完整L0–L3或embedding。结构化SSE夹具证明配置路由、原子写入和错误保护，不能认证真实模型提炼质量、全部第三方网关、Windows/DPI、屏幕阅读器或正式安装升级；环境跳过不计通过。源码及内嵌文档已构建，正常退出旧实例后从`.\run-experimental.cmd`查看实验版。

## 2026-11-10 TencentDB 官方提示词逐字核验

本节对应用户进一步要求“记忆分析模型的提示词100%完全按照GitHub官方仓库”。核验发现宿主曾在官方system后追加`Host storage bounds`及不可变记忆ID两段文本，因此旧实现不能称提示词逐字一致。已移除这两段，直接传递上游`TencentMemoryModelRequest`；现有容量、来源/目标检查、已确认偏好保护、取消及原子提交由宿主代码继续执行。

### 官方来源核验

官方仓库为`TencentCloud/TencentDB-Agent-Memory`，GitHub tag `v2.0.3`直接对应`084bed45cad6bb7f877455082cee82835d65671a`，提交时间`2026-10-26T11:36:37Z`。独立只读审计逐一获取`MemoryCore/src/`下25个固定manifest文件的HTTP原始字节，全部HTTP200，官方/本地/manifest三方SHA-256一致，无源码或源manifest改写。

| 官方提示文件 | 核验SHA-256 |
| --- | --- |
| `core/prompts/l1-extraction.ts` | `4a443a170a5c6d754c8212728a2fa23b1d1f647d49f960b7e10b6a6cc5761816` |
| `core/prompts/l1-dedup.ts` | `be6c909e78bc9d8d8fa58b1111e6d7d5de41af0778fd7062ceeeababd497f389` |

该固定提交的`MemoryCore/package.json`包名为`@tencentdb-agent-memory/memory-tencentdb-v2`、npm版本`1.0.2-beta.1`；本文`v2.0.3`指GitHub tag，不能混称npm版本或宣称动态跟随未来上游。

### 本轮实现与验证

- 活跃`chat`提取及冲突system、user模板直接复用原始模块常量和formatter。主分析、备用以及未设置时的主会话模型均不附加宿主、profile或项目指令。
- Service测试动态导入原始vendored模块，对两阶段system和user模板分别作完整`toBe`相等断言，不再只检查关键字；主模型失败→备用的runtime用例另检查`instructions`相等。
- `workspace-memory-settings-smoke.mjs`直接加载原始官方常量，在本地HTTP接收处对每次实际提取/冲突system作严格相等断言；错误会进入最终失败检查。其余8组功能和UI断言保留。
- README、第三方/宿主NOTICE及双语内嵌手册明确逐字复用和宿主适配边界。构建自动同步运行时NOTICE及资源哈希，没有手工编辑生成清单。独立只读代码复核无阻塞发现。

Vitest在`apps/desktop`，其余命令在根目录：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run src/main/agents/tencent-memory-service.test.ts src/main/chat/decision-memory-runtime.test.ts --maxWorkers=1 --fileParallelism=false
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check scripts/workspace-memory-settings-smoke.mjs
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/workspace-memory-settings-smoke.mjs
.\package-win.cmd --check
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test scripts/tencent-memory-package.test.cjs
git diff --check
```

| 检查 | 本轮最终结果 |
| --- | --- |
| 提示词及记忆流程定向Vitest | 2文件68项通过、0失败/跳过，18.89秒，退出0；service39/runtime29 |
| Node/Web TypeScript | 通过 |
| Biome | 292文件通过，无自动改写 |
| 生产构建 | main102/preload3/renderer2225，25个上游源模块哈希通过；实验out包含本次提示透传修正及内嵌手册 |
| 真实Electron增强设置专项 | 8组通过，2次启动，5次chat/7次extract/3次dedup，renderer异常0；10次分析HTTP的完整system均与官方相等 |
| 用户打包预检 | `package-win.cmd --check`退出0，33资源、生产依赖及1.3.0通过 |
| TencentDB资源Node测试 | 19项通过，0失败/跳过 |
| 脚本语法与diff空白 | 通过 |

真实Electron仍用独立临时profile、临时工作区和本地结构化SSE，不访问正常用户DB/Key/记忆或付费模型。Node24直接导入原始TS出现`MODULE_TYPELESS_PACKAGE_JSON`警告，测试退出0；未改变根模块类型或源文件以隐藏警告。GUI覆盖沿用上一节8组功能及20状态布局，未新增前端源码或重跑设计detector；不将本节重采截图混称额外视觉设计验收。

本轮精确保证是固定提交官方`chat`模式的两阶段提示词与模板逐字一致。当前轮20条/32000字符/每条8000字符的输入边界、未使用旧背景或连续情境状态、FTS和JSONL快照存储、严格结果校验、保护已确认偏好及备用模型仍是宿主适配，不能扩大为完整TencentDB算法/产品100%移植或真实模型语义质量认证。没有重跑完整Vitest及其余桌面专项，不以此前1203项替代本轮68项。

版本1.3.0、schema7、政策修订号及原子图标保持；无上游源码/manifest修改、正式安装包、云SQL、Git提交或推送。正常退出旧进程后从`.\run-experimental.cmd`启动更新实验版，已有out时入口不会自动构建。

## 2026-11-10 实际1.3.0 ZIP与发布SQL

用户先要求核对打包材料，主流程实际执行`.\package-win.cmd --check`，33项资源/生产依赖/1.3.0通过；用`D:\NodeJs\node.exe` v24.19.0执行8份打包、ASAR、资源及图标Node测试，55项全部通过、0失败/跳过，37.976秒。只读独立复核确认最新记忆透传在`out/main/index.js`，builder包含`out/**`及Tencent、文档、许可、native、OCR、AST、LSP和SDK映射。该阶段未生成解包或NSIS。

用户随后自行打包并确认安装包已生成，本轮读取既有发布产物：

| 字段 | 实际值 |
| --- | --- |
| 元数据 | `apps/desktop/release-artifacts/MingshenHarness-1.3.0-x64.zip.json` |
| 版本 / 格式 | `1.3.0` / `zip` |
| 文件名 | `MingshenHarness-1.3.0-x64.zip` |
| SHA-256 | `551d665b93f174bf8f6ea8faa13647838ea22840ee83f66759d23afc98a35d17` |
| ZIP字节数 | `293630075` |
| 本地修改时间 | `2026-11-10 12:00:33`（Asia/Shanghai） |

使用PowerShell `Get-FileHash -Algorithm SHA256`及`Get-Item`核对实际ZIP，并与JSON、`.zip.sha256`旁文件比较，全部一致。未使用EXE哈希或旧1.2.9包值，未重新构建或写入包。

`supabase/publish-release.sql`已填上述版本、ZIP格式、哈希与字节数，保留8个既有发布字段及`on conflict (version) do update`。公告按当前1.3.0实际功能重新整理为784字符，符合`0001_init.sql`的1000字符硬上限。下载地址改为`REPLACE_WITH_PUBLIC_HTTPS_ZIP_URL`明确占位符，用户提供公开HTTPS ZIP直链后才可执行；现有HTTPS约束会拒绝未替换占位符。部署文档及AGENT当前发布条目同步，不自动填旧分享网页，不修改云端较高测试版本。

静态检查确认SQL与JSON版本/哈希/大小一致、无旧哈希占位或example.com发布地址、公告长度合规、upsert保留，diff空白通过。此次只生成本地SQL材料，未连接或执行Supabase、未上传文件或安装应用，也未重复运行Vitest/GUI；读取实际包不能代替正式安装、升级与卸载验收。执行发布前仍需已部署`0003_zip_updates.sql`，同版本重发不会向已安装1.3.0客户端提示更高版本。
