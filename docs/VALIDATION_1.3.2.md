# Mingshen Harness 1.3.2 验证记录

核对日期：2026-11-11（Asia/Shanghai）。按用户要求升级至1.3.2，调研并适配 Gemini / DeepSeek 缓存；后续保持1.3.2补齐表格单元格富内容和原生公式，并新增Google Gemini原生协议，专项结果见文末。当前schema8保留全部历史迁移和已有数据，政策修订号`2026-11-04.3`和原子图标不变；下文schema7为此前阶段事实。

## 已完成的定向检查

- `pnpm --filter @mingshen/desktop exec vitest run src/main/providers/prompt-caching.test.ts src/main/providers/provider-prompt-caching.test.ts src/renderer/src/lib/orbit-transcript.test.ts src/main/chat/context-compaction-service.test.ts`：4文件161项通过（4.48秒）。覆盖精确官方地址与伪装端点、模型体系配置持久化、无异厂缓存参数、原生状态的Orbit隐藏与独立文本摘要过滤。
- `provider-service.test.ts`与`token-saver.test.ts`的用量专项：最终2文件70项通过（3.95秒），此前67项与其重叠不相加。覆盖 Gemini 原生字段别名、DeepSeek命中/未命中、标准字段优先、未知与明确零值、非法及不一致计数。
- 原生续接最终定向命令为 `D:\NodeJs\node.exe node_modules/vitest/vitest.mjs run src/main/providers/provider-native-state.test.ts src/main/chat/provider-native-runtime.test.ts src/main/providers/model-stream.test.ts src/main/token-saver/stable-input.test.ts src/main/chat/compaction-request-cache.test.ts`（在`apps/desktop`目录）：5文件105项通过（2.52秒，原生状态15项）。覆盖消息及工具签名、最终快照补尾、DeepSeek各协议原生推理、实际ChatService/SQLite重建后续接、失败重试清理、nullable推理占位及服务端中断拒绝保存。此前139、102及单文件12项与本轮有重叠，不相加。

## 完整源码检查与首次失败

- `pnpm typecheck`：Node/Web TypeScript通过。原生状态最后补丁后Node定向类型检查及最终两套检查均通过，最终证据为`.impeccable/review/v132-cache-checks/typecheck-final.log`。
- 第一次`pnpm lint`在原生状态代码仍修改期间报告7处格式/规范错误及2条警告；修复后`pnpm lint`通过，Biome检查323文件、504ms，无自动修改。证据：`.impeccable/review/v132-cache-checks/lint.log`及`lint-final.log`。
- 首次`pnpm --filter @mingshen/desktop exec vitest run --no-file-parallelism`退出1：122文件通过、1失败、4环境跳过；1540项通过、1失败、10跳过（209.29秒）。失败为`provider-native-state.test.ts`的最终快照应补全`Final answer`而只有`Final `。命令启动后相关测试与实现仍在并行收尾，最终快照协调修复后该文件12项、后续5文件105项已通过；首次命令不能表述为全绿。最终源码稳定后的完整重跑结果另记。证据：`.impeccable/review/v132-cache-checks/vitest.log`。
- `node --check`通过：`scripts/provider-cache-smoke.mjs`、`scripts/composer-drafts-smoke.mjs`、`scripts/session-management-smoke.mjs`。后两者的旧版本断言已改为与当前manifest一致，不把语法检查当作重新执行其桌面回归。

## 稳定源码全量检查与最终构建

第二次完整命令仍通过pnpm调用Vitest，退出1：122文件通过、1失败、4跳过；1543项通过、1失败、10跳过（233.59秒）。失败是既有TencentDB链接快照用例超过5000ms，随后清理junction返回EBUSY，证据为`.impeccable/review/v132-cache-checks/vitest-final.log`。检查进程发现实际Vitest worker使用`D:\NodeJs\node.exe`（24.19.0），不能仅凭外层pnpm使用捆绑Node就认定全部worker也是相同运行时；此类Windows链接夹具边界已有历史记录。本轮没有提高超时、绕过链接防护或修改该测试以掩盖失败，也不据此断言已证实Node上游缺陷。

用捆绑Node 24.22.1直接启动该TencentDB文件，39/39项通过（2.44秒，`tencent-bundled-node.log`）。随后源码稳定时，在`apps/desktop`目录用同一绝对路径运行完整串行检查：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run --no-file-parallelism
```

最终退出0：**123文件通过、4跳过；1544项通过、10跳过**（212.11秒）。证据为`.impeccable/review/v132-cache-checks/vitest-bundled-final.log`。前述各定向检查和失败重跑与本轮有重叠，不能累加成额外测试数。

- 最终`pnpm lint`通过：Biome检查323文件、630ms，无自动修改。证据为`lint-copy-stable.log`。全量Vitest后的改动仅为修正创建/编辑供应商中“必须以/v1结尾”的过时双语提示；该文案首次格式检查要求合并一行（`lint-copy-final.log`），处理后通过，没有为纯文案重复整套Vitest。
- 最终`pnpm build`退出0：main110、preload3、renderer2236模块；25份固定TencentDB源码哈希通过，实验out及内嵌手册、更新日志与协议已重建。证据为`build-copy-stable.log`；此前`build.log`和`build-copy-final.log`保留各自阶段结果。
- 最终`.\package-win.cmd --check`退出0：33项资源、生产依赖及1.3.2版本预检通过，证据为`package-check-copy-final.log`。这是源码资源预检，不是NSIS、解包安装或升级验收。
- `git diff --check`退出0，仅提示仓库既有LF/CRLF转换。检查沿用进程级`pnpm_config_verify_deps_before_run=warn`，未删除或手改`node_modules`、永久关闭校验或变更系统防护。

除注明文件外，上述日志均在`.impeccable/review/v132-cache-checks/`。

## 真实Electron桌面专项

运行`node scripts/provider-cache-smoke.mjs`，使用自有临时profile、合成Key及本地SSE；官方外观URL也由fixture拦截到本地，不向真实供应商发送请求。

完整成功证据为`.impeccable/review/v132-provider-cache/attempt-2026-11-11T11-55-52-366Z/result.json`：13/13组通过，34次普通Agent本地请求（标题辅助请求不计入此数），2次启动和2次正常退出，强制退出0；renderer/服务端错误、崩溃及意外外网请求均0，`temporaryRemoved:true`、`failure:null`。覆盖未知网关不注入提示、OpenAI/Claude原功能、Gemini/DeepSeek体系保存与隐式模式、usage尾帧与未知/零值、协议不匹配、精确官方识别与Other覆盖、新供应商创建、重启持久化和供应商删除清理。

此前`attempt-2026-11-11T11-53-28-588Z/result.json`保留失败：前9组通过、25次请求后，IPC创建的官方fixture未刷新React供应商列表而等待超时。fixture补充重载后完整重跑通过，没有为此修改产品；该次正常退出并清理成功，不能表述为首次全部通过。

完整专项采集Claude/Gemini/DeepSeek × 中英文 × 日夜的12张1040×680简约风格截图。审查者实际逐图查看，无阻断的遮挡或水平溢出；主流程查看Gemini中文夜间和DeepSeek英文日间时发现Base URL旧提示与官方例外矛盾，已修正创建和编辑两处并重建。Impeccable detector本轮只运行一次，目标`ProviderCacheSettings.tsx`，结果为成功目录的`detector.json`空数组；不重复执行。光轨、移动端、全部DPI或辅助技术矩阵未在此专项认证。

最终文案重建后执行`node scripts/provider-cache-smoke.mjs --screenshots-only`退出0：新增模式复用同一截图矩阵与隔离/网络/清理逻辑，只创建持久化fixture并验证渲染，不重复完整功能请求。最终证据为`.impeccable/review/v132-provider-cache/attempt-2026-11-11T12-04-20-110Z/result.json`，`mode:screenshots-only`，2组截图断言通过、普通模型请求0，错误/崩溃/意外外网均0；1次启动及1次正常退出、0强制、`temporaryRemoved:true`、`failure:null`。审查者实际查看全部12张最终截图，中英文新说明正确、无重叠或水平溢出；主流程另实际打开最终Gemini中文夜间及DeepSeek英文日间两图复核。该次不增加前述13组功能验证次数；最终语法及`git diff --check`通过，无新增产品改动，无需为验收脚本和交接记录再次构建。

## 测试临时数据保留边界

桌面专项的自有profile已正常清理；上述TencentDB超时夹具留下两个合成临时目录：

- `C:\Users\ASUS\AppData\Local\Temp\mingshen-tencent-memory-nV6tcn`
- `C:\Users\ASUS\AppData\Local\Temp\mingshen-tencent-memory-outside-FnQoOp`

第一目录中的`.harness-tencent-memory`为指向第二目录的junction，第二目录仅为测试`outside sentinel`。已核对准确路径和链接目标；受保护的递归清理及随后更窄的非递归清理均在执行前被自动审批策略拒绝，只返回`blocked by policy`。没有删除上述目录，不通过其他工具重试绕过该拒绝。残留不属于产品资源、正常用户记忆或数据库，也不影响最终源码检查和构建结果。

## 当前验证边界

所有模型请求验证使用本地合成接口或stub，不使用真实API Key或付费模型。未测量真实供应商的缓存命中率、费用或延迟收益，不保证固定命中率。Gemini显式缓存资源的创建、存储和TTL管理未启用。旧会话中先前未保存的原生字段不伪造或从展示推理反推。

本轮尚未生成1.3.2 NSIS/ZIP，不安装、不升级、不上传、不执行云SQL、不Git提交或推送。已有维护者生成的1.3.1安装包和发布SQL保留原版本及真实SHA/大小。

## 表格单元格富内容专项

用户已确认正文Word原生公式可用，本次保持1.3.2，补齐此前仅接受字符串的表格单元格。DOCX/PDF支持严格的`{"blocks":[...]}`对象，包含paragraph、rich_paragraph、equation、markdown、list、code、quote；旧字符串保留字面语义及原表头样式。DOCX公式写入单元格内的原生OMML，PDF保留排版；PDF脚注及PPTX对象单元格明确拒绝。每格50块/20,000字符，显式子块计入全局1,000块/500,000字符及模板替换累计，不能通过表格或模板绕过上限。

### 源码检查

在`apps/desktop`中用捆绑Node24.22.1运行：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run src/main/documents/document-author.test.ts src/main/documents/document-rich-content.test.ts src/main/documents/document-table-cells.test.ts src/main/documents/document-creation-tools.test.ts src/main/documents/document-pdf.test.ts
```

最终5文件**118项通过**（4.85秒），其中新`document-table-cells.test.ts`有17项，覆盖六类公式确实位于`w:tc`、行内/多块顺序、字面字符串、富表头、Markdown嵌套表及公式、脚注和超链接关系、模板几何与累计限制、PDF MathML/转义、格式拒绝及不支持公式。实际工具网关回归另覆盖富单元格成功写入，以及不支持公式/远程Markdown图片出错后保留旧文件完整字节。网关实际经过hash及write_binary，不把渲染成功等同于文件提交。

- `pnpm typecheck`最终退出0，Node/Web两套TypeScript通过。
- `pnpm lint`最终退出0，Biome检查324文件、713ms，无自动修改。
- `pnpm build`最终退出0，main110/preload3/renderer2236模块，25份固定TencentDB源哈希通过，实验out及内嵌文档已重建。
- `.\package-win.cmd --check`最终退出0，33项资源、生产依赖及1.3.2版本通过；这是资源预检，不是安装包验收。
- Node语法与PowerShell AST检查通过，两份文档验收脚本可解析；`git diff --check`仅有既有LF/CRLF转换提示。

本轮定向检查与此前运行有重叠，不相加；未为本次表格改动重跑完整仓库Vitest，不能将上文缓存适配的1544项宣称为表格专项结果。pnpm校验只用进程级`pnpm_config_verify_deps_before_run=warn`，没有删除或手改node_modules、永久关闭检查。

早期检查曾暴露并修复TypeScript的flatMap联合类型推断、新测试的xmldom Document.textContent为空预期、工具网关测试遗漏hash步骤及新测试格式问题。修复后的上述命令均通过；这些是过程记录，不是剩余失败。

### 真实工具生成

仓库根目录执行：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/document-authoring-smoke.mjs
```

最终退出0，**15组通过、47次Agent本地请求、辅助请求0**。成功证据为`.impeccable/review/v132-document-authoring-1794400392623/result.json`。真实create_document/read_document流程覆盖：

- DOCX原有中文、图片、表格、纸张和分页，PPTX原生文本/表格/图表及工作簿，PDF中文和分页，以及正文OMML、Markdown、页眉页脚、目录和脚注回归。
- 表格DOCX包含12×2外表及2×2嵌套Markdown表，共28个OOXML单元格。10个OMML公式全部位于单元格内，覆盖分式、方框、cases、积分、点标记、中文、行内混排、Markdown公式及多块内容。链接和原生脚注关系有效，字面字符串和代码未被误解析为公式。
- 表格PDF为2页，回读确认全部标记和中文，全部页面栅格化且非空白。实图检查后补齐MathML方框边框、独立公式对齐及公式中文字字体。
- 模板填充保留输入字节、纸张/边距、原文及页眉；输出含3个公式，其中2个位于表格，原有和新增共3条脚注保留，表格内超链接关系有效。
- 不支持单元格公式、远程Markdown图片、PPTX富单元格和PDF单元格脚注均返回明确错误并无输出；默认覆盖拒绝、显式覆盖、请求批准的真实拒绝路径继续通过。

实际打开并查看全部7张专项图片：DOCX语义预览1张，普通PDF、表格PDF和公式PDF各2页。表格公式可见，中文、边框、行内混排、多段及嵌套表无阻断性遮挡或越界；语义HTML预览不充当Word排版证据。脚本收集的errors断言为空；没有独立采集完整外网计数或正常/强制退出次数，不作这些数字承诺。命令退出0，finally应用关闭及自有临时数据清理已完成。

两次先前尝试分别保留在：

- `.impeccable/review/v132-document-authoring-1794400006999/`：中文文本断言失败，PDF尚未复制；只保留失败前生成的文件和终端错误，无failure.json。
- `.impeccable/review/v132-document-authoring-1794400190672/failure.json`：同一断言失败；新增提前保存PDF、原始提取文本及页面后，确认公式中文字可见，但提取的“文”为兼容汉字。测试使用NFKC规范化后比较，仍保留全部中文断言；产品公式中文字改用正文字体。实际页面还揭示了方框边框缺失和对齐问题，修复后重新构建并完成上述15组，不宣称首次全部通过。

### Word编辑及页面核验

成功生成后执行：

```powershell
.\scripts\document-office-render-smoke.ps1 `
  -EvidenceDirectory 'C:\Users\ASUS\Documents\ChatGPT\MingshenHarness\.impeccable\review\v132-document-authoring-1794400392623' `
  -PdfToPpm 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe'
```

退出0，结果位于该目录`word-render/result.json`。Word实际识别正文8个公式、模板3个公式（其中2个表格公式）及表格夹具10个公式（全部在表格内，外表12行2列）。在独立副本中将第2行第2列公式改为`t^2+2`，BuildUp、保存、关闭并重开后仍有10个表格内原生公式；编辑后的页面已实际查看，目标公式保留上标及加法。原有正文公式副本编辑、保存和重开检查也通过。

全部Word输出页面已逐图打开检查：native-math3页、filled-template1页、table-math1页、editable-table-copy1页，共6页。六类表格公式、多段内容、嵌套表、脚注和超链接均显示，无阻断性缺字、重叠、截断或越界。验证只操作本轮生成文件及副本，禁用宏、不加入最近文件，拒绝复用已有打开文档的Word实例；不认证任意Office文档、Word版本及Windows/DPI/GPU矩阵。

按documents技能尝试`render_docx.py`时，将PATH限制为捆绑Poppler及Windows System32，明确得到`FileNotFoundError: LibreOffice soffice.exe was not found on PATH`。Windows捆绑运行时未提供LibreOffice，没有改用用户安装的LibreOffice；日志为首次证据目录的`libreoffice-render.log`。本轮排版核验采用真实Word导出及捆绑Poppler栅格化，不能冒称LibreOffice验收通过。

README、文档工具说明、双语用户手册和更新日志、工具提示与AGENT交接同步。仅使用自有临时profile/项目、合成Key和本地SSE，不访问正常用户DB/Key/记忆/剪贴板，不调用付费模型。没有生成NSIS/ZIP、安装、升级、云SQL、Git提交、推送或发布。正常退出旧实验实例后运行`.\run-experimental.cmd`使用本次构建；PPTX表格仍只接受字符串，单元格内图片/图表等未声明块仍明确拒绝。

## Google Gemini原生协议专项

保持1.3.2，新增第四种`gemini_generate_content`协议及`x_goog_api_key`鉴权。请求使用Google原生contents/parts和SSE、工具functionCall/functionResponse、原始thoughtSignature及native usage，不转换为OpenAI接口。官方文档、discovery定义和SDK来源及边界见[供应商缓存说明](PROVIDER_CACHING.md)。本轮新增schema8永久迁移，只扩展providers约束，V1–V7不改；保留政策修订号、图标和固定TencentDB上游。

### 源码、迁移和构建

- 最终`pnpm typecheck`退出0，Node/Web两套TypeScript通过；`pnpm lint`退出0，Biome327文件通过，无自动修复。
- 原生协议、审批主备和压缩真实管线最终定向3文件105项通过：`gemini-native.test.ts`28项、`approval-protocol-failover.test.ts`7项、`context-compaction-service.test.ts`70项。其他定向测试和此前运行与最终全量重叠，不相加。
- 覆盖原生URL及auth编辑/活动保护、分页过滤和重复分页拒绝、图片/音频/PDF和文本回退、同名工具调用/结果顺序、无服务端ID、空/独立签名Part、原始边界、作用域不匹配、取消/截断/安全拦截、思考参数、用量及缓存指纹。真实ChatService/文件SQLite关闭重开验证续接；工具执行前估算允许pending调用，实际未配对请求仍在fetch之前拒绝。
- 数据库测试覆盖schema1–7逐级升8、供应商/Key/模型/会话/消息/设置保留、重开、外键关系检查及失败事务回滚。历史迁移版本断言保持原值，只有当前schema断言升8。

在`apps/desktop`使用捆绑Node直接执行完整串行回归：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vitest/vitest.mjs run --no-file-parallelism
```

退出0：**125文件通过、4跳过；1603项通过、10跳过**（177.84秒）。PDF夹具输出3条`Indexing all PDF objects`警告，没有失败；跳过项仍为环境相关测试，不宣称全部环境均验收。

最终`pnpm build`退出0：main112/preload3/renderer2236模块，25份固定TencentDB源哈希通过。`.\package-win.cmd --check`退出0，33项资源、生产依赖及1.3.2版本通过。实验out和内嵌文档已重建；这是资源预检，不是安装包、升级或ASAR验收。pnpm只使用进程级`pnpm_config_verify_deps_before_run=warn`，未修改node_modules或永久关闭校验。

### 真实Electron桌面

仓库根目录运行：

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/gemini-native-smoke.mjs
```

最终退出0，**8/8组通过**，证据为`.impeccable/review/v132-gemini-native-1794405351010/result.json`：

- 真实首次配置界面选择原生协议，预填Google URL和鉴权头，保存合成凭据。
- 模型发现跨2页，编码分页标识并排除embedding模型；1次generateContent连接测试成功。
- 普通Agent执行4次本地SSE请求，辅助请求0；同一轮两次read_file读取自建文件，分别覆盖无wire ID及有wire ID，保留原始签名Parts及结果顺序。
- 缓存800/输入1000报告为partial，思考用量接入Token Saver；没有把结构稳定当作实际供应商缓存认证。
- 正常退出、重启后原生供应商、模型、凭据及精确签名历史续接。MAX_TOKENS明确失败，不执行未完成工具、不保存其原生状态。
- 2次启动、2次正常退出、0强制；服务端/renderer错误、崩溃、意外外网均0；临时数据已清理，`failure:null`。合成数据库schema8、integrity ok、foreign key无违例。

实际逐张打开全部5张最终截图：首次配置、简约中文夜间1040px、简约英文日间800px、光轨中文日间800px、光轨英文夜间1040px；原生协议/鉴权、固定Gemini体系、双语文案及设置滚动均可见，无阻断性重叠或水平越界。所有截图高度760px，未认证全部DPI、GPU或辅助技术矩阵；首次表单滚动展示时上方字段可在滚动返回后访问，不将截图裁剪当作隐藏字段。

首次尝试证据为`.impeccable/review/v132-gemini-native-1794405243486/result.json`：未配置供应商时已在首次配置页，脚本却等待主界面的设置按钮而超时；普通请求0、正常退出及清理通过。修正为直接使用已存在的表单后完整重跑，未为夹具问题修改产品。其他早期夹具修复包括PDF字段、压缩系统提示断言、活动保护报错匹配及cacheOutcome枚举，不冒称首次全部通过。

### 交付边界

README、双语USER_GUIDE/CHANGELOG/隐私政策、SECURITY、供应商缓存说明和AGENT同步。当前共享模型入口可选择native供应商；审批主备及压缩跨协议回归已通过，记忆分析沿同一请求客户端，无新供应商专用旁路。

全部请求仅发送到自建本地HTTP/SSE服务，官方外观地址由fixture拦截；没有真实Google账户、私人Key、正常用户数据库/记忆或付费API验证，不保证实际缓存率及任意网关兼容。未实现Vertex AI、Interactions、输出媒体或显式缓存资源管理。未生成NSIS/ZIP、安装、升级、云SQL、Git提交、推送或发布。正常退出旧实例后运行`.\run-experimental.cmd`体验本轮构建。

## 2026-11-12 打包资源复核

用户只要求检查资源与提供自行打包命令，本轮不生成正式包。当前工作区为`C:\Users\ASUS\Desktop\MingshenHarness`，开始时Git工作区干净。

- `node scripts/check-package.cjs --source`退出0，33项资源、生产依赖及1.3.2版本通过，含原子ICO、native哈希、TencentDB源/运行时哈希与闭包、文档作者依赖、OCR和七种Windows grammar。
- 只读核对10处`extraResources`源全部存在，根/桌面package和release常量均1.3.2，清单依赖specifier与lockfile一致。正式包装脚本解析到根`node_modules/electron/dist`，Electron45.2.1及EXE、关键DLL、资源与locales存在；NSIS仍为x64当前用户安装，未签名，使用既定图标。没有新执行afterPack或安装器验证。
- 默认`.\package-win.cmd --check`退出1，pnpm在资源检查前尝试同步依赖，因无交互终端报`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`。安装状态JSON仍记录迁移前的`C:\Users\ASUS\Documents\ChatGPT\MingshenHarness`绝对路径。仅对后续检查进程设置`pnpm_config_verify_deps_before_run=warn`后，同入口退出0，33资源通过，workspace不同步警告仍保留；不是首次默认入口通过。

附加测试命令：

```powershell
node --test scripts/package-paths.test.cjs scripts/package-runtime-copy.test.cjs scripts/package-document-runtime.test.cjs scripts/tencent-memory-package.test.cjs scripts/windows-icon.test.cjs scripts/generate-icon.test.cjs scripts/prepare-experimental-runtime.test.cjs
```

退出1：54项中46通过、8失败、0跳过（9.91秒）。8项失败均在实验准备测试访问固定的`apps/desktop/node_modules/electron/dist/electron.exe`时返回ENOENT；默认实验准备实现也固定此路径。当前hoisted安装的Electron位于根`node_modules`，正式打包脚本使用模块解析，已确认可定位其运行时。本轮没有改实验脚本或测试，不把失败隐藏成跳过或全部通过；未运行会写LocalAppData BuildCache的package-native-copy专项。

维护者在有交互的PowerShell先同步依赖，再检查和打包：

```powershell
Set-Location 'C:\Users\ASUS\Desktop\MingshenHarness'
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' install --frozen-lockfile
.\package-win.cmd --check
.\package-win.cmd
```

pnpm已在PATH时，第二行可直接使用`pnpm install --frozen-lockfile`；安装和检查成功后再执行下一条。完整打包自动准备图标/native、重建应用、预检及afterPack，预期输出为`apps/desktop/release-artifacts/MingshenHarness-1.3.2-x64.exe`、`.zip`、`.zip.sha256`、`.zip.json`。当前该目录只有历史版本发布材料，未见1.3.2包。本轮没有实际同步依赖、永久关闭校验、修改node_modules、生产构建、完整Vitest、解包/NSIS/ZIP、安装升级、云SQL、用户数据操作、提交或推送；本次只追加检查记录。

## 2026-11-12 迁移后运行时缺失修复

用户随后已成功冻结lockfile重装依赖，安装状态指向Desktop新路径；自行打包在生产构建和预检后因缺少`node_modules/electron/dist/version`失败。实际安装的Electron45.2.1 npm包没有postinstall，提供独立`install-electron`/`install.js`，依赖重装未恢复dist及path.txt。此次原因与上节旧workspace元数据不同，修复没有再次重装全部依赖。

- 新增`scripts/provision-electron-runtime.cjs`，通过模块解析定位当前Electron，验证Windows x64运行时版本、path.txt和关键文件；缺失时调用包内官方安装器，保留包内ZIP校验和并复检。
- 桌面`package:win`在生产构建前准备Electron；`package-windows.cjs`直接入口同样保护。`--check`保持只读，新增运行时检查，缺失时给出明确准备命令。
- 实验准备、其测试及`run-experimental.cmd`使用解析后的EXE路径，兼容根hoisted及app-local依赖；不修改原始electron.exe。README和交接中的当前打包路径、1.3.2输出说明同步。

实际执行`node scripts/provision-electron-runtime.cjs`退出0，官方安装器成功恢复根`node_modules/electron/dist`中的45.2.1。随后执行：

```powershell
node --test scripts/provision-electron-runtime.test.cjs scripts/package-paths.test.cjs scripts/package-runtime-copy.test.cjs scripts/package-native-copy.test.cjs scripts/package-document-runtime.test.cjs scripts/tencent-memory-package.test.cjs scripts/windows-icon.test.cjs scripts/generate-icon.test.cjs scripts/prepare-experimental-runtime.test.cjs
.\package-win.cmd --check
.\package-win.cmd --dir
```

- Node专项9文件，**63通过、0失败、0跳过**（20.78秒）；含迁移后中文/空格路径、hoisted/app-local解析、缺失运行时的只读失败、版本/平台/伴随文件异常、实际子进程调用fixture安装器、完整运行时复用、失败及不完整安装拒绝，以及原生复制/图标/资源专项。测试不访问网络；真实Electron安装是前述独立步骤。
- 默认`--check`退出0：33项资源、生产依赖、Electron及1.3.2版本通过，没有设置`pnpm_config_verify_deps_before_run=warn`。
- 完整`--dir`退出0：生产构建main112/preload3/renderer2236模块，25份TencentDB源哈希通过；原版Electron暂存、EXE优先部署、ASAR生产依赖和afterPack资源检查均通过。builder提示未配置签名及其他平台可选依赖未打包，Windows x64依赖检查通过。
- 实际解包EXE：`C:\Users\ASUS\AppData\Local\MingshenHarness\BuildCache\windows-1.3.2-7F7wF4\output\win-unpacked\MingshenHarness.exe`。

这次验证包含解包构建，不含正式NSIS编译、ZIP生成、安装/升级或GUI验收；未运行全量应用Vitest，部分历史桌面smoke固定app-local路径的问题仍未纳入此次修复范围。未修改版本/图标、用户profile/数据库/Key、云服务或发布材料，未提交/推送。当前维护者直接运行`.\package-win.cmd`生成正式安装包，无需再次安装全部依赖；未来重新迁移则先在新目录正常同步依赖，再由入口准备Electron。

## 2026-11-12 已有1.3.2安装包发布SQL

维护者已自行完成正式打包，并提供GitHub Releases的`V1.3.2/MingshenHarness-1.3.2-x64.zip`下载直链。新增完整可执行的[supabase/publish-release-1.3.2.sql](../supabase/publish-release-1.3.2.sql)，保留旧版本SQL，不沿用旧包元数据。当前SQL填入：

- 版本`1.3.2`、格式`zip`，下载地址为`https://github.com/SkyH1aa/MingshenHarness/releases/download/V1.3.2/MingshenHarness-1.3.2-x64.zip`。
- 本地ZIP重新计算SHA-256：`14883fad61715f6f7a03f3a334dead291f983e14f1056c971fd7c84d0e173a23`。
- ZIP实际大小：**293723586字节**；与`.zip.json`及`.zip.sha256`完全一致。
- ZIP根目录仅有`MingshenHarness-1.3.2-x64.exe`，解压长度293737762字节；流式计算包内EXE SHA-256，与旁置EXE一致。
- SQL沿用现有表/字段及`on conflict (version)`，公告涵盖Gemini原生协议、Gemini/DeepSeek状态及缓存兼容、表格富内容和原生公式、数据迁移及Windows构建修复，检查1000字符上限。

Supabase README及部署指南同步到1.3.2。此次只读取本地产物并生成SQL/文档，未重新下载远端ZIP、运行云端SQL、认证线上RPC生效、重打包、安装/升级、上传、提交或推送；不是智能体完成正式打包。此前“未生成NSIS/ZIP”保留为相应开发阶段的历史边界。维护者在已执行0003迁移的Supabase SQL Editor手动执行新文件，再运行`select * from public.mingshen_get_latest_release_v2();`核对。
