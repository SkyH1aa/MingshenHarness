# Mingshen Harness 1.2.7 验证记录

日期：2026-11-06（Asia/Shanghai）。本轮交付源码与已构建实验版，不生成或安装 NSIS，不执行云端 SQL，不使用用户数据库或历史测试 Key。

## 计划生命周期

- `SessionWorkbenchService.prepareTurn` 在下一条用户消息开始时清除全部完成/取消的活动步骤、暂停、断点和待判断状态。本轮结束时仍可查看完成结果；聊天中的旧工具记录及用户另存的项目计划不删除。
- 新普通消息遇到未完成计划时保留步骤和进度，标记 `reviewRequired`。当前模型比较最新请求与旧计划，调用 `review_plan` 明确 keep/discard 并说明原因：继续相关任务保留 ID、完成状态、依赖和断点；无关、废弃或替代任务清空后可创建新计划。
- 模型判断前阻止其他工具操作，不因计划清理改变文件权限或解除不确定副作用屏障。版本不匹配、非法 action 和空原因不会修改计划。权威计划每轮加入系统提示，历史工具记录不能复活已清理步骤。
- 显式“从恢复点继续”直接准备当前计划并保留最新用户编辑，不重置完成进度。普通新消息不再被旧暂停状态提前拦截。模型不提交有效判断时最多三次请求后明确失败，保留计划，支持重试或用户编辑。
- 旧计划判断中、暂停、等待用户、中断、失败及空闲未完成步骤均为静态状态；只有实际执行的进行中步骤转圈。

## 上传文档

- 附件从上传的实际字节调用内置解析器，支持 PDF、DOC/DOCX、XLSX/XLS、PPTX、ODT 和常见文本/代码后缀。不依赖用户另给工作区路径、PowerShell 压缩库、pandoc 或 Office 程序。扫描与旧DOC是下方同版本补充加入的能力。
- 三种协议的文本模型请求可包含提取内容；Responses/Anthropic 配置原生 file 输入时保留原生 PDF。前端允许可解析文档在文本模型下发送，不误标不兼容。
- 每个附件仍最多 25 MiB；核对声明大小和字节，最多保留 120,000 字符并标记截断。解析错误与无文字结果明确告知，不伪造阅读成功。Office ZIP 在解析前限制 4,000 条目、展开总量 100 MiB、单项 32 MiB，并拒绝加密条目。
- 提取文字随新消息保存在本地。旧保存附件在模型请求及摘要前按需解析；不改写旧历史。内容以不可信文档数据标注，摘要按现有已配置模型及主备规则发送。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| `pnpm.cmd test` | 67 个测试文件通过；393 项通过，2 文件内 8 项外部环境测试按开关跳过 |
| `pnpm.cmd typecheck` | Node/main 与 renderer 两套 TypeScript 通过 |
| `pnpm.cmd lint` | Biome 检查 201 文件通过 |
| `pnpm.cmd build` | main 74 模块、preload、renderer 2106 模块生产构建通过，实验入口 out 已更新 |
| `pnpm.cmd audit --prod` | 检查时无已知生产依赖漏洞 |
| `scripts/v127-plan-attachments-smoke.mjs` | 真实 Electron 7 组通过、15 次本地 Responses SSE 请求，无未捕获异常 |
| `scripts/task-workbench-ui-smoke.mjs` | 真实 Electron 4 组通过、8 次本地请求、两个真实委派 worker；停止/退出/重启/最新计划恢复、任务树流式预览与双语紧凑布局回归通过 |
| `package-win.cmd --check` | 23 项资源、生产依赖、原生 grammar/绑定和版本 1.2.7 预检通过 |
| 打包/图标 Node 测试 | 路径、复制、EPERM 回退、原生复制和实验图标共 14 项通过 |
| 空白检查 | `git -c core.safecrlf=false -c core.autocrlf=false diff --check` 通过 |

本轮源码测试覆盖完成清理、新计划接收、keep/discard、过期版本/非法参数、恢复进度、权限不扩大、项目计划/恢复屏障保留、真实 DOCX/PDF 提取、三协议传送、两协议原生 PDF、旧附件压缩、截断、损坏、加密/超限 Office、大小不符和取消。

最终补充 `.PDF` 大小写识别后，六个相关文件 71 项测试通过，Biome201文件、生产构建与diff空白检查再次通过；393项为此前完整回归的结果，不将这次专项写成另一次全量重跑。

新桌面专项使用 renderer 9375/main inspector 9376、独立临时 profile 和本地模拟模型：完成后新计划、暂停后无关请求、相关续跑、取消后清理并重启、无效判断三次退出及有效重试、真实文件输入同时上传 PDF/Word、英文日间 1040×680 和十份内嵌文档 1.2.7。原恢复/子输出专项使用 9373/9374。所有 UI 专项顺序运行，测试进程和临时数据自行清理，不操作真实用户会话。

已查看 `.impeccable/review/v127-plan-review-zh-night.png`、`v127-plan-review-en-day.png`、`v127-uploaded-documents-zh-night.png`；计划静态状态可见，紧凑窗口无操作区越界。测试脚本最初有 evaluate 括号缺失、附件菜单未打开导致无 file input，修正测试后完整通过；失败运行不计入通过结果。

## 文档和数据

应用、SDK 默认版本、启动/打包入口、README、三份中英文协议、使用手册、更新日志和发布部署说明同步 1.2.7。服务/免责正文无新条款，隐私明确已有附件文字的本地提取与摘要范围。`POLICY_VERSION` 保持 `2026-11-04.3`，不因纯应用升版强制重新同意。schema7、全部历史迁移和用户数据保护保持，不新增云收集。

## 验证边界

- 本地 SSE 测试证明请求内容和执行/展示流程，不保证任意模型都能准确判断任务相关性或理解文档。无效判断明确失败，用户可重试或编辑计划。
- 最初阶段的扫描PDF/旧DOC缺口已由下方补充填补。识别准确率、图表公式和排版仍不能保证；加密、损坏及超限文件保留具体限制。
- 没有付费外部模型、真实账户 MCP、BrowserDo/Embiody、新一轮 Docker/原生逃逸测试或跨 Windows/代理矩阵验收。8 项环境跳过不计通过。
- 没有 NSIS 生成、安装、卸载、覆盖升级或云端发布。资源预检不是安装包验收，不作零缺陷保证。

实验版启动：根目录 `run-experimental.cmd`。维护者自行打包仍使用根目录 `package-win.cmd`，预期生成 1.2.7 EXE、ZIP、SHA-256 和大小 JSON；未创建安装包，后续解包尝试结果见下。

## 扫描PDF、视觉模型与旧Word补充

日期同为2026-11-06，应用仍1.2.7。以下为用户补充需求后的结果，不将上方393项旧结果当本次结果。

### 能力与边界

- PDF自动路由：Responses/Anthropic且配置file输入时发送原PDF；其他image模型接收带页码PNG；纯文本模型使用随包Tesseract离线简体中文/英文OCR。Chat Completions的file标记不代替原生PDF支持。含文字标题和扫描图像的混合页面也参与OCR。
- Word97–2003真实OLE `.doc`通过word-extractor提取Unicode正文、页眉/脚注等；现代`.docx`保留mammoth解析。不运行宏、不启动Office/PowerShell/外部转换器，不保证图片/版式还原。
- 25MiB输入、120K字符、本地PDF检查200页、图像/OCR20页、图像总20MiB和长边2000px、180秒超时；两个并发worker、可取消排队及执行。明确记录页数、OCR置信度、遗漏/截断和无可识别文字，不伪造读取成功。
- 原始附件/提取文字本地保存，临时页面图像不入库；重启或模型能力切换重新适配。成功缓存最多16项/48MiB，不缓存失败或半成品，摘要保留读取范围警告。OCR仅用本地语言包，不连接额外识别服务。上传内容以不可信数据处理。
- 文档工具先审批，再经MXC或Docker二进制网关读取，然后调用可信解析器。worker限制资源和取消，不是OS安全沙箱；安全边界见SECURITY。手写/公式/复杂表格建议视觉模型并核对原文，未对真实付费模型做识别准确率评估。

### 实测结果

| 检查 | 结果 |
| --- | --- |
| 全量源码测试 | 69文件405项通过，3文件9项环境测试按开关跳过 |
| TypeScript / Biome / 生产构建 | 两套TS、204文件检查和main/preload/renderer构建通过 |
| 生产依赖审计 / 源打包预检 | 无已知漏洞；24资源及canvas绑定、OCR语言/worker/WASM通过 |
| PDF/DOC源码测试 | 真实DOC Unicode、中英混合页OCR、21页视觉上限、切换模型/重建、取消、审批拒绝不读/批准才读、Docker错误传播通过 |
| 真实Windows MXC | `MINGSHEN_DOCUMENT_E2E=1`，默认backend：批准读取扫描PDF与DOC，一组通过 |
| 真实Docker | 同测试设置backend=docker，一组通过；初次引擎未运行失败，启动已有Docker Desktop29.9.2后通过 |
| `document-vision-smoke.mjs` | 真实Electron8组/7次本地请求通过，三协议vision、两协议native、OCR+DOC+DOCX、重启重建与解析中停止均通过，页面图像不持久化 |
| `document-asar-smoke.cjs` | 真实Electron使用临时ASAR/物理解包依赖，中英OCR、PNG渲染、DOC及依赖闭包通过 |
| `v127-plan-attachments-smoke.mjs` | 7组/15次本地请求回归通过：完成/废弃清理、相关任务续跑、无效判断恢复、附件及双语文档 |

新增源码夹具由本地canvas生成纯光栅PDF，既有文字与手绘曲线仅用于传输验证，不代表真实手写识别质量。真实旧DOC来自word-extractor MIT上游固定提交，SHA-256和许可位于`scripts/fixtures/legacy-word-LICENSE.md`。ASAR测试创建完整文档依赖闭包和同配置解包模式，但不是完整应用分发包。

`package-win.cmd --dir`在Electron运行时暂存阶段复制`d3dcompiler_47.dll`仍遇EPERM；诊断目录`%LOCALAPPDATA%\MingshenHarness\BuildCache\windows-1.2.7-L4ztzi`保留。未关闭防护/改ACL/跳过校验，不把局部ASAR测试写成完整解包构建成功。没有NSIS安装、卸载、覆盖升级或云SQL执行，未使用私人Key/用户数据库，BrowserDo/Embiody免测。

双语内嵌手册、更新日志和隐私说明同步，README/SECURITY/第三方清单及AGENT同步。POLICY_VERSION与schema7不变，既有永久迁移保留，服务/免责正文无新条款。实验out已构建；最终启动仍为根目录`run-experimental.cmd`。
