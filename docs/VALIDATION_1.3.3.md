# Mingshen Harness 1.3.3 验证记录

日期：2026-11-14 至 2026-11-15（Asia/Shanghai）。版本：1.3.3。范围：光轨企业工作台视觉与动效升级、输入预览自动跳转修复、DOCX旧稿局部编辑与精细排版、版本/文档同步。以下UI检查为11月14日结果，文档工具追加验收独立记录于末尾，不累计重叠测试数。

## 设计与研究边界

本次先用本地设计技能的企业应用方向库评估现有光轨工作台，选定的方向为 `data-terminal`（seed `59374359`）：导航退后、真实状态与证据在前、每个选中态使用贴边的 1px 状态线，避免填充胶囊、泛光和装饰性渐变。外部产品网页抓取在当前环境连续超时，未引用未实际读取的网页；实现依据现有 `DESIGN.md`、真实组件结构和该本地方向库，而不是伪造外部调研引用。

界面升级集中在 `apps/desktop/src/renderer/src/orbit-workbench.css` 的 1.3.3 层：

- 统一工具轨、会话侧栏、面包屑、状态栏、审查、终端和任务区的表面、边框与标题节奏；输入框是唯一刻意抬升的对话表面。
- 移除工具轨填充胶囊与输入框内部第二圈焦点框，改为 1px 状态线和更轻的选中底色；保留冰白矿青、窄光轨和原子图标。
- 动效只用于状态与连续性：输入框聚焦短光轨、运行节点与状态栏缓慢呼吸、流式消息轻微落定、详情/设置层短距离展开。应用动效关闭和系统减少动态效果会停用位移与循环动画。

## 输入预览修复

原实现用粘贴标记加 `requestAnimationFrame` 复位，普通输入、IME 组合输入或过期的粘贴标记可能让 `formatted` 状态在“编辑原文”时被打开。现在：

- `ChatView.tsx` 只在粘贴事件仍挂起且浏览器报告粘贴/插入输入时打开预览；普通键入、IME 组合输入、预览内快捷键和空/不支持粘贴不会触发。
- 新增 `composer-input.ts` 纯函数 `shouldOpenPastePreview`，并用单元测试覆盖 `insertFromPaste`、`insertFromPasteAsQuotation`、`insertText`、`insertCompositionText`、无挂起标记和关闭设置。
- 预览仍保留原始 Markdown/LaTeX 源文本用于发送；预览内再次粘贴仍可进入预览。

## 源码与构建检查

在仓库根目录执行：

```powershell
pnpm --filter @mingshen/desktop typecheck
pnpm --filter @mingshen/desktop lint
pnpm --filter @mingshen/desktop exec vitest run src/renderer/src/lib/composer-input.test.ts src/renderer/src/lib/composer-markdown.test.ts src/shared/ui-preferences.test.ts
pnpm --filter @mingshen/desktop build
node scripts/check-package.cjs --source
```

- TypeScript Node/Web 两套检查退出0。
- Biome 检查 **329 文件**通过，无自动修改。
- 定向 Vitest **3 文件、14 项**通过。
- 生产构建退出0：main112 / preload3 / renderer2237 模块，25 份固定 TencentDB 源哈希通过；CSS 产物 314.03 kB。
- 打包预检退出0：33 项资源、生产依赖和 **1.3.3** 版本通过。

## 真实 Electron 专项

### 输入预览

```powershell
node scripts/composer-rich-paste-smoke.mjs
```

退出0，**11/11 组通过**，8 张截图、1 次本地聊天请求，renderer 异常/崩溃/网络意外均为0。覆盖 Markdown/表格/KaTeX 粘贴预览、原文保留、编辑/预览切换、原生撤销/重做、Ctrl+A/Ctrl+X、中文输入法组合输入、预览内再次粘贴、空/不支持粘贴不误跳、发送原文、设置开关、恶意 HTML 清理、超大草稿回退和图片附件；并覆盖简约/光轨、中英、日夜、1440/1040/800 宽度。

### 光轨工作台

```powershell
node scripts/orbit-workbench-smoke.mjs
```

退出0，**12/12 组通过**，13 次本地请求、2 次 worker 请求、30 张截图，renderer 异常0。覆盖独立工具轨/侧栏/面包屑/状态栏、真实文件变更与命令输出、执行时间轴、审查与任务并排、布局切换保留草稿与编辑器、子 Agent 隔离、中英日夜、800/1040/1920/2559 宽度、抽屉边界、样式切换和模型/供应商长名称。

### 长时间历史与性能

```powershell
node scripts/orbit-stability-smoke.mjs
```

退出0，**11/11 组通过**，**0 布局问题**、48 条测量、13 张截图、无 renderer 异常/崩溃。基准：光轨 1440 空闲输入 P95 **9.1ms**、脚本 31.1ms、0 长任务；流式输入 P95 **61.8ms**、脚本 433.3ms、0 长任务。合成历史为 373 条消息和 180 个 `view_image` 调用，用于布局/长历史压力，不代表真实视觉模型质量。

### 完整 Vitest

首次并行执行：

```powershell
pnpm --filter @mingshen/desktop test
```

退出1：**130 文件、1615 项**中 122 文件通过/4 跳过、1601 项通过/10 跳过，4 项失败。失败均在 Windows 临时目录相关测试：`tool-cache-index`、`tencent-memory-service`、`lsp-diagnostics-service`、`decision-memory-runtime`，表现为 5000ms 超时及随后 `EBUSY` 清理失败，和本次 UI/输入改动无直接调用关系。保留首次失败，不宣称为全绿。

串行重跑上述 4 个文件：

```powershell
pnpm --filter @mingshen/desktop exec vitest run --no-file-parallelism src/main/tools/tool-cache-index.test.ts src/main/agents/tencent-memory-service.test.ts src/main/agents/lsp-diagnostics-service.test.ts src/main/chat/decision-memory-runtime.test.ts
```

退出0：**4 文件、95 项全部通过**（35.31秒）。这与历史并行临时目录抖动一致，支持“非本次 UI 回归”的判断；仍不能据此宣称所有 Windows 并发环境稳定。

### 截图复核

实际查看 1440 夜间运行态、夜间空态、日间完成态和 800 紧凑态截图：输入框焦点、工具轨选中线、会话层级、执行时间轴和右侧审查/任务区没有阻断性遮挡或水平溢出。800 抽屉截图中右侧面板与主区的明暗对比受透明叠加和截图时序影响，未将其当作产品主题冲突；完整 Windows DPI、GPU、辅助技术和所有主题组合仍未验收。

## 版本与发布边界

根/桌面 `package.json`、`release.ts`、SDK 默认版本、启动/打包提示、README、双语更新日志/使用手册、协议适用版本、第三方说明、SECURITY、AGENTS/AGENT 已同步为 **1.3.3**。历史 1.3.2 安装包、发布 SQL、SHA-256 和大小保持原记录；1.3.3 尚未生成正式 NSIS/ZIP，也未上传、执行云SQL、安装/升级或提交/推送。

## 尚未覆盖

- 外部企业 Agent 产品的网页调研未能在当前网络环境完成；没有引用未读取的资料。
- 未生成或安装 1.3.3 正式安装包，未验证 NSIS 安装/卸载/升级。
- 未覆盖完整 Windows DPI、GPU、辅助技术、所有输入法和真实系统剪贴板矩阵；输入专项使用合成粘贴事件和 Chromium 模拟组合输入。
- 未进行付费模型、真实供应商缓存、云服务或用户正常数据库/Key/记忆访问。

## 2026-11-15 文档工具追加验收

### 改动与定位方式

`read_document`和`read_file`新增DOCX `structure:true`，返回完整源SHA-256、正文block及paragraph编号，支持原有游标分页；paragraph包含表格单元格，页眉页脚不纳入编辑索引。`create_document.edit`不要求旧稿预埋占位符，支持跨run唯一文字替换、完整正文段落/表格区段替换/删除及仅修改段落排版。全部操作按编辑前同一快照定位，源SHA不符、歧义、越界、重叠或不支持结构会在提交前失败。默认另存；原稿读取独立经过profile权限、审批与执行网关。

DOCX/PDF增加对齐、段前后间距、倍数行距、首行/左右缩进、分页与同页控制；表格支持列宽比例，DOCX写入固定网格及单元格宽度。旧稿/模板带列宽表格使用原稿尺寸，只接受明确单节单栏正文。独立Word公式同时设置数学段落对齐，避免普通段落左对齐仍被Word居中；独立公式justify按左对齐处理。

### 源码检查

在仓库根执行：

```powershell
pnpm typecheck
pnpm --filter @mingshen/desktop lint
pnpm --filter @mingshen/desktop exec vitest run src/main/documents src/main/chat/document-authoring-runtime.test.ts --maxWorkers=1
pnpm build
node scripts/check-package.cjs --source
```

- Node/Web TypeScript均通过。
- Biome **331文件**通过，无自动修改（729ms）。
- 定向Vitest **11文件通过/1文件跳过，193项通过/1项跳过**，退出0（34.38秒）。涵盖结构索引/源SHA、跨run及表格文字、富内容插入与部件保留、布局XML/PDF CSS、公式对齐、源读取策略/人工审批、隔离读取、取消、覆盖/原地冲突、容量及跨段保护范围。
- 生产构建退出0：main113 / preload3 / renderer2237模块，25份固定TencentDB源哈希通过。
- 源码资源预检退出0：33项资源、生产依赖和1.3.3版本一致。

本轮早期测试有2项既有HTML字符串断言失败：无布局时新增了多余样式分号，随后改为仅在有新增布局时追加样式，最终上述范围重跑全部通过。中间失败及此前重跑与最终193项相重叠，不合计为更多用例。

### 真实Electron工具调用

```powershell
node scripts/document-authoring-smoke.mjs
```

退出0，**18/18组通过**，60次本地Agent请求、0次辅助请求，9张截图。最终证据目录：

```text
.impeccable/review/v133-document-authoring-1794752646597/
```

包含既有DOCX/PPTX/PDF生成和读取、正文/单元格原生公式、模板、图表与工作簿、错误不写半份文件、覆盖和审批拒绝等回归。新增真实旧稿结构读取→SHA→无占位符区段替换→跨run/表格单元格文字修改→段落排版流程，核对原稿未变及未改的页眉/页脚/媒体/元数据等部件保留；旧SHA失败时原稿和已有输出均不变。新增两页排版PDF，检查行距、缩进、公式间距、3:1表格及段前分页。

工具生成PDF共8页，均已打开查看，另查看DOCX语义预览1张。未发现阻断性裁切、重叠或缺字；测试中显式分页后的留白为夹具设计。公式PDF中Markdown嵌套列表沿用既有偏大间距，本轮未全面重做Markdown默认排版。语义HTML只证明可读取内容，不代表Word版面。

### Word真实排版与可编辑性

使用documents技能的标准`render_docx.py`尝试渲染，但返回`FileNotFoundError: LibreOffice soffice.exe was not found on PATH`；没有将该尝试记为成功，也没有验证LibreOffice兼容性。采用当前机器可用的Microsoft Word COM执行仓库已有验收脚本：

```powershell
& .\scripts\document-office-render-smoke.ps1 `
  -EvidenceDirectory 'C:\Users\ASUS\Desktop\MingshenHarness\.impeccable\review\v133-document-authoring-1794752646597' `
  -PdfToPpm 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe'
```

退出0。脚本只操作生成夹具，禁用宏、不加入最近文件，已有Word文档时拒绝操作，保存编辑使用独立副本。6份DOCX导出**8页**：正文公式3页，模板、表格公式、原稿、修订稿、表格公式编辑副本各1页；全部最新PNG均已逐页查看。

- 正文8个原生公式；表格10个单元格内公式；模板3个公式，其中2个在表格内。正文/表格公式分别修改、保存、重开通过。
- 修订稿保留原页眉、页脚、图片及原脚注，新增脚注后编号正常。
- Word实际属性：首行缩进18pt、段后8pt、行距18pt/倍数规则1（夹具12pt文字的1.5倍）、两端对齐、段中不分页；表格列宽比3.0000000636。
- 首次Word视觉检查发现独立公式仅设置`w:p`对齐后仍居中，随后新增`m:oMathParaPr/m:jc`及对应回归，并重跑构建、193项定向测试、18组桌面专项和本Word流程。最终修订稿`equationJustification:3`（Word左对齐），PNG中的`x²+1`已与正文左边对齐。

实际属性和编辑结果在同一证据目录的`word-render/result.json`，页面在`word-render/`。前轮证据`v133-document-authoring-1794752233144/`保留为修复前记录，不当作最终源码的渲染结果。

### 边界与交接

这是受控的DOCX局部编辑，不是任意旧稿无损重排。选区涉及书签、批注、跨段字段/权限范围、修订、内容控件、分节或脚注引用等时拒绝；签名/宏文件拒绝。未完整验证文档级`settings.xml`保护。正文XML及ZIP会重新序列化；富内容插入会更新必要样式、编号、脚注及关系，不能保证所有Office扩展无损或分页不变。富内容插入要求标准`w:`前缀，其他前缀只支持已覆盖的行内文字/段落排版；页眉页脚不支持直接索引编辑。

版本保持1.3.3，schema8和协议修订号不变。提示词、README、双语手册/日志、[文档工具说明](DOCUMENT_TOOLS.md)及根交接第52节已同步。未在本轮重新执行全应用测试、ASAR文档专项、正式NSIS/ZIP、安装/升级、云SQL、付费模型或Git提交/推送；未认证完整Office版本、LibreOffice及第三方扩展兼容矩阵。退出旧实验实例后运行`.\run-experimental.cmd`使用已构建实验版。

收尾静态检查：`git diff --check`无空白错误；新增编辑模块/测试和本记录另用`--no-index --check`检查，无空白诊断（新增文件比较返回1表示存在差异）。8份相关Markdown经现有Marked解析后，114个本地文件目标均存在。Git仅提示既有LF/CRLF转换，未为此批量改写文件。

## 2026-11-17 大型 Skill 导入与模式调研

### 实际改动

- 本地Skill/插件单扩展文件上限4,000→20,000；检查发生在加入文件前，目录和被忽略目录不消耗数量。
- 技能市场单技能文件上限1,000→20,000，超限错误包含具体数量；先数量/大小预检，再下载和导入。
- 64MiB大小、单技能正文32,000字符和扩展正文总预算120,000字符保留。市场计入远端全部blob，本地沿用忽略目录，未改变两者既有计数范围。
- 双语手册/日志同步。三模式及办公增强只完成源码审计和联网调研，见[调研记录](AGENT_MODES_RESEARCH_1.3.3.md)，尚待用户确认附件、联网、Office及切换边界，未实现或迁移。

### 定向验证

```powershell
pnpm --filter @mingshen/desktop exec vitest run src/main/extensions/extension-service.test.ts src/main/marketplace/skill-marketplace-service.test.ts --maxWorkers=1
pnpm --filter @mingshen/desktop typecheck
pnpm --filter @mingshen/desktop lint
pnpm build
```

- Vitest退出0：2文件通过，6项通过、1项环境开关控制的真实GitHub集成跳过，3.00秒。
- 本地边界使用仅覆盖资源目录readdir的虚拟20k/20k+1清单，其余文件操作走真实文件系统：20,000通过数量检查后触发既有64MiB限制；20,001在扫描阶段拒绝，两者均不复制/入库。真实小Skill覆盖正常复制、忽略目录、资源、前置元数据、上下文绑定和去重。
- 市场边界使用新鲜离线缓存：20,000进入64MiB检查，20,001数量拒绝；两者fetch调用为0，无install临时目录、扩展目录或数据库记录。
- Node/Web TypeScript通过；Biome331文件通过，无自动修改（775ms）。
- 生产构建退出0：main113/preload3/renderer2237模块，25份TencentDB固定源哈希通过；未生成安装包。
- `node scripts/check-package.cjs --source`退出0：33项资源、生产依赖和1.3.3版本一致性通过。`git diff --check`无空白错误，仅提示已有LF/CRLF转换。

首轮定向运行退出1：新增真实20,000文件导入夹具加安装副本共约40,000文件，afterEach删除超过10秒Hook超时，随后同文件2个既有用例各5秒超时；总139.10秒，3项失败，市场1项跳过。将高IO夹具替换为上述边界和小目录测试后重跑通过；保留首次失败，不据模拟目录扫描宣称Windows真实20k导入耗时或稳定性已验收。

### 边界

没有本轮完整应用测试、真实GitHub大技能下载、真实20k端到端成功/性能验收、Electron界面专项、ASAR、NSIS/ZIP、安装/升级、付费供应商、正常用户数据/Key、云SQL或提交/推送。CodeAgent/WorkAgent/ChatAgent待用户答复，没有把调研计划写成完成项。schema8、协议修订号和版本1.3.3保留。

## 2026-11-17 三模式、Chat 隔离与 Code/Work 专精实装

本节记录前面“待确认/未实现”和 schema8 之后的后续实装进展，属于新增验证历史；不修改、不删除前文对当时状态的记录。以下“已实装”指当前源码已具备对应入口和边界，不等同于正式安装包、Office 全矩阵或最终视觉验收已经完成。

### 模式、会话与数据迁移

- 主界面已提供 CodeAgent、WorkAgent、ChatAgent 三种模式切换，不把模式入口放在设置页。CodeAgent 与 WorkAgent 共用工作台、工作目录、会话、历史、草稿及附件；ChatAgent 使用独立页面、独立会话目录和分组。
- 数据库 schema 已由 8 升级到 9，新增会话 `agent_mode`、`chat_group_id` 及聊天分组相关结构。旧数据迁移后会话默认属于 CodeAgent，原有历史不被清空、不复制到另一套伪造会话中。
- ChatAgent 不选择工作目录，不提供自定义 Agent Profile，固定为宿主侧只读聊天。Chat 会话与 Code/Work 工作区会话不能原地互换；从 Chat 进入工作区模式需要进入对应工作会话。
- 现有 Profile 默认同时适用于 CodeAgent 和 WorkAgent；新增 `applicable_modes_json` 后，自定义 Profile 可限定为其中单一模式或两者。ChatAgent 不提供自定义 Profile。
- WorkAgent 快捷新建在主进程中一次选择目标模式兼容的 Profile，避免先继承 Code-only Profile、随后切换 WorkAgent 时失败。从 Chat 切换时，如果后台工作会话仍在运行，前端按切换前的真实页面回退，并把后台会话忙碌计入锁定状态。
- 模式切换在任务运行期间锁定。用户须等待本轮结束或手动停止后再切换；切换只影响下一轮，已有历史、目录、草稿和附件继续保留。

### ChatAgent 上传与工具边界

- ChatAgent 允许用户主动上传图片、PDF、Word、Excel、PPT 等只读材料进行问答。当前支持范围以解析器实际接受的常见格式为准，包括 PNG、JPEG、WebP、GIF、BMP、TIFF、AVIF 位图、PDF、DOC/DOCX、XLS/XLSX 和 PPTX；旧二进制 PPT、SVG、伪装 MIME 或文件头不匹配的内容会明确拒绝，不宣称任意 Office 扩展都能解析。
- 单文件上限为 25 MiB，主进程按真实编码字节再次核验；图片同时检查 MIME 和文件头签名。Chat 只解析用户上传的字节，请求构造时移除调用方提供的本地路径和预提取内容，不提供任意本地路径读取或文件修改工具。
- Chat 的工具发现和执行入口双层限制为 `web_search`、`web_fetch`。不开放浏览器点击、浏览器登录、命令执行、MCP、Skills、Hook、自定义工具、本地文件读写或子 Agent；仅把工作目录设为空或依赖提示词不构成该隔离。
- `web_fetch` 采用公开网络策略，阻止 localhost、私网、链路本地及 metadata 目标，并在访问前和重定向过程中检查 DNS 解析结果，避免借重定向绕过目标限制。
- 上传内容的只读问答不等于任意旧稿无损解析。扫描版 PDF 的 OCR 质量、复杂表格版式、宏/加密/签名文件、旧二进制 Office 格式、全部页面或第三方扩展兼容性仍需分别验证，失败时不能伪称已经读取。

### CodeAgent 专精能力

- 工程领域技能改为元数据目录加 `use_skill` 按需分页加载，避免把所有技能正文一次性注入上下文。技能资源继续受相对路径、文本类型和大小限制，加载技能不等于执行脚本或扩大工具授权。
- 新增连续失败保护：同一工具和规范化参数连续失败 3 次后阻止原样重放并要求切换策略；连续失败或拦截达到 12 次时停止本轮。任一成功结果会重置连续失败计数。
- 大工具输出进入可恢复存储，通过 `read_tool_output` 按会话隔离分页恢复。单条捕获最多 4,000,000 个 UTF-16 字符，单会话最多保留 40 条、合计 16,000,000 个 UTF-16 字符；超出捕获上限时保留头尾并明确标记中间缺口。80,000 字符以上的输出进入恢复存储。
- 运行级快照之外增加文件级受限检查点。单文件上限 25 MiB，单检查点和单轮累计均上限 128 MiB，每轮最多 128 个检查点；恢复只处理 manifest 范围，不清理范围外文件。
- 任意 shell 命令和外部 MCP 的副作用不享有逐文件写前快照保证。检查点达到预算或无法覆盖时保留运行开始快照并显示提示，不把局部保护描述成完整事务。
- 代码工作流继续使用 AST/LSP、测试、类型检查、Lint、诊断和验证闭环；验证会按风险追踪失败项、修正后的重跑结果及未覆盖范围，避免把构建成功单独当成行为正确。

### WorkAgent 与 Office 专精能力

- WorkAgent 已加入 Excel 结构化创建与编辑，覆盖单元格类型、公式、区域/追加行、样式、列宽、合并、冻结、筛选、表格及工作表操作；同时记录源文件 SHA，并检查公式和重算状态。
- WorkAgent 已加入 PPTX 旧稿受控编辑，可按源 SHA 修改既有形状文字、表格单元格和备注；DOCX 旧稿的局部文字、区段、段落和表格列宽编辑继续保留。未修改的 ZIP 部件保留原始字节，宏、签名、外链、OLE 或无法保真的复杂部件会拒绝，不声明任意旧 Office 文件无损。
- Office 生成与修改统一经过资产读取、源 SHA、输出预检、覆盖审批、隔离网关、文件锁、外部变更检测和取消处理。每个文件原子提交；PDF 和重算工作簿不构成跨文件事务。
- WorkAgent 内置按需办公技能，覆盖 Word、Excel、PPT、分析、研究和办公运营，并有共享交付质量流程。流程强调故事板、网格、字体层级、排版、图表表达、商务主题和逐页渲染检查，不把“能生成文件”当成已经达到可交付质量。
- 在已安装 Microsoft Office 且权限与隔离策略允许时，WorkAgent 主会话可选用 COM 做公式重算和渲染检查。仅 WorkAgent 主会话、full-access host 路径启用；不自动安装 Office，使用临时副本，并记录自动化进程的名称、可执行路径、创建时间及命令行，正常、超时和取消时只清理本次确认的进程身份。
- Office 未安装、COM 权限不足、隔离策略不允许或已有不确定 owner 的同类 Office 实例时降级，并在交付结果中明确标记未验证项。宿主执行失败不会静默回退到绕过隔离的路径；已有用户 Office 实例也不会按进程名批量结束。

### 失败历史与最终回归

- 首次完整回归在当时源码上运行 134 个文件，127 个文件通过、4 个文件失败、3 个跳过；1698 项中 1659 项通过、29 项失败、10 项跳过，另有 1 个 unhandled，耗时 621.29 秒。该轮不是最终通过结果。
- 对上述 4 个文件做独立范围运行时，记录为 62 项通过、15 项失败。并行环境中的超时和 Windows `EBUSY` 不能未经定位就归因于业务逻辑必然失败，因此没有用简单放大总超时来掩盖问题。
- 长尾定位表明主要问题是 Windows 临时目录、子进程或异步清理延迟。Tencent 链接快照专项中，服务探测约 166 ms；原 Vitest worker 内偶尔创建 junction 约需 4 秒，越过 5 秒上限，超时后链接仍存在又会触发 `afterEach` 的 `EBUSY`。
- 修复针对测试夹具而不是总超时：Windows 先尝试 directory symlink，遇 `EPERM`/`EACCES` 时通过 `execFile(process.execPath, ["-e", 固定脚本, target, link])` 创建真实 junction；非 Windows 使用 `fs.symlink`。清理前校验链接位于当前 `mkdtemp` 根目录内，以 `lstat` 确认为链接后只 `unlink`，不跟随范围外目标。
- Tencent 链接专项最终 39/39 项通过，4.37 秒；定向链接测试 1/1 项通过，约 496 ms；该文件 Biome 通过。
- 修复后的完整串行回归 session `37609` 退出 0：136 个文件，133 个通过、3 个跳过；1730 项中 1718 项通过、12 项跳过；18:53:30 开始，耗时 267.54 秒。该轮早于下文最后的发送准备锁和 COM 预检/阶段诊断补充；后续变动另做定向与桌面验证，不把旧数字当成再次执行全量。该结果不能扩展解释为所有 Windows 并行环境永久稳定。
- 本轮最新源码还通过 TypeScript 类型检查；Biome 348 个文件通过，549 ms；源码资源预检通过，共 48 resources。
- 开发过程中曾通过 production build：main 121、preload 3、renderer 2242 个模块。该结果只证明当时构建通过；最终 build 和 smoke 由主执行者继续验收，本节不把它写成正式安装包验收。

### Office、视觉与剩余边界

- `agent-modes-smoke.mjs` 早期曾在 WorkAgent 自动渲染回传断言处失败，原因是已渲染页面没有进入模型工具结果。后续由主执行者修正 preview 的相对/绝对路径并加入 runtime regression；中间失败保留，不写成最终失败，也不据此宣称最终 smoke 已全绿。
- 本轮早期 Word 打开阻塞，未通过；不能用第 52 节历史 Word 8 页记录或此前文档专项替代本轮 COM 接口验收。最新诊断结果见下文，仍未把 Word 渲染记为通过。
- 此前 Electron smoke 曾记录 8/8 通过，但主执行者视觉检查发现 800 宽度 composer 塌缩，随后修复；当时仅靠水平溢出断言不能发现输入框被挤入 0px 网格列。最终重建、增强断言及视觉结果见下文，旧截图不作为修复后证据。
- 当前仍不宣称任意旧 Office 文件无损、任意公式均已计算、全部页面已完成视觉验收或第三方扩展全兼容。
- 本轮没有生成或验证正式 NSIS/ZIP，没有执行安装/升级、付费供应商请求、正常用户数据访问、云 SQL 或发布。版本保持 1.3.3；工作区已有大量有效未提交改动，不应清理或回退。

### 最后补充与最终桌面验收

发送准备和运行状态锁继续补齐：`ChatView` 在草稿落盘及附件 `FileReader` 之前上报准备状态；`App` 按会话分别保存准备锁和启动锁，避免不同会话互相覆盖/误释放。编辑后重发在 IPC 前加启动锁，失败立即释放，成功保持至运行结束；准备结束不清除正在运行的锁。`runsBySession` 的运行状态也参与切换判定。

窄窗修复将桌面侧栏偏好与窄屏抽屉状态分开保存，并给 Chat 设置明确的 grid area；≤900px 时输入区始终占完整主列。增强 smoke 现在检查输入框的实际宽度和边界，800px 通过可见按钮打开抽屉，再选中会话验证自动收起；从 800 回到 1440 不覆盖桌面侧栏偏好。

COM 可靠性补充：先确认本次创建的 Office 进程身份，再证明实例的 Documents/Workbooks/Presentations 为空，最后才登记可清理 pidfile；非空或无法证明为空时不执行 Close/Quit，也不按记录 PID 清理。Word 使用 16 参数 `OpenNoRepairDialog`，明确隐藏、只读、不修复、不显示编码对话框，不修改 Office 全局选项或 Protected View。超时和失败附带最后阶段，隔离输入/输出路径脱敏。

COM 前独立检查 OOXML 外部关系、Word 跨 run 自动字段及 XLSX 数据连接部件：普通外部超链接允许，外部模板/图片等自动关系、INCLUDETEXT/INCLUDEPICTURE/LINK/DDE/DDEAUTO/DATABASE 字段及 connections/queryTables/externalLinks/pivotCache/model 部件使 COM 降级为 unavailable，保留结构检查。该专属预检不改变普通 inspect/edit 的支持范围，不能将其描述为所有旧稿编辑都拒绝全部外链。

最新检查：

- `pnpm typecheck` 通过；最后 `pnpm lint` 通过，348 个文件（328ms）。中间一次 Lint 因新增锁回调的两处格式未通过，按 Biome 格式修正后重跑通过，未改业务行为。
- `pnpm build` 退出 0：main121 / preload3 / renderer2242 模块，25 份固定 TencentDB 源哈希通过；main 1390.33kB、CSS 328.95kB。这是源码生产构建，不是安装包。
- Renderer 定向 3 文件、18 项通过，874ms：模式/Profile/附件规则、会话锁互不误释放、输入预览及持久草稿。
- Office、文档运行链路及决策运行时定向 3 文件、74 项通过/3 项手动 COM 跳过，18.34 秒。覆盖新 COM 预检、阶段/脱敏、ownership、安全降级及相对预览路径遇到绝对 Office 回执时仍将页面图片传给模型。
- 单独启用 `MINGSHEN_RUN_WORD_COM_TEST=1` 的真实 Word 诊断未通过：返回 `unavailable / OFFICE_IN_USE`，最后阶段“检查 Office 进程”，0 PDF 字节，源字节不变。该用例要求 verified，因此退出 1（1 项失败/20 项过滤跳过，2.22秒）；没有为让测试通过而关闭既有 Word。更早的 Open 阻塞没有被本次占用降级证明修复。
- 手动超时用例不再依赖 Excel 启动恰好超过 5 秒，并修正旧的“超过”文案断言；用仅测试调用的负逻辑期限抵消外层 5 秒宽限，使 PowerShell 外层计时器立即触发，断言 failed/“限定时间”且无 PDF/重算文件。单独过滤执行该用例 1 项通过/20 项过滤跳过（1.54秒），没有把它称为已经验证 Office 实例清理；真实实例清理继续以对应历史证据为准。

最终执行 `node scripts/agent-modes-smoke.mjs` 退出 0：**11/11 组通过，21 次本地模拟模型请求，11 张界面截图，0 renderer 异常**。证据目录：

```text
.impeccable/review/v133-agent-modes-1794915550504/
```

实际覆盖 Code/Work 共用会话与目录、运行中前后端锁和手动停止、写前局部检查点、90k 命令输出按 call ID 恢复、Chat 独立目录与本地面板隐藏、5 类真实上传字节解析和移除本地路径、伪造本地文件/命令/Skill/MCP/子 Agent 调用拒绝、renderer 表单新建/改名分组、分组移动/删除保留会话、搜索/置顶/归档/恢复及真实 Electron 正常重启持久化。新增延迟 FileReader 与延迟 chat:rewrite IPC 夹具分别确认准备期锁、IPC 失败解锁及成功后保持运行锁；不将这些 fixture handler 加入产品。

Work 真实 Excel 流程完成按需加载工作流、生成公式、结构读取、Microsoft Excel 重算、PDF 导出及页面图片回传；结果为 `42 * 2 = 84`，随后一次模型请求确有 `input_image`。该 PDF 唯一页面 `office-page-1.png` 已实际打开查看，文字和数值可读，无裁切/重叠；这是最小计算夹具，不能充当复杂报表美观或公式兼容矩阵的验收。

已实际查看本轮 1440px 光轨 Chat 日/夜、Code 夜间、800px Chat 日/夜和抽屉、分组表单截图，输入框完整、桌面侧栏恢复、未发现阻断性遮挡或水平溢出。前轮 `1794913279850` 9/9 结果中桌面日间曾截到加载态；本轮增加 reload 标记和 composer 就绪等待后重新截图，不用加载截图证明最终布局。

先前 Excel 正常/超时/取消的确切测试实例清理结果仍作为对应轮次证据；不能由此宣称系统全部 Office 进程都已清空。收尾看到既有 Word，未接管；此前发现的无 owner PowerPoint 也没有被批量结束。PowerPoint 曾导出有效 PDF但尚无本轮逐页目视验收；Word 本轮仍未验收通过，未安装/缺授权/占用/隔离受限时继续明确降级。没有新增正式安装包或访问正常用户 profile、Key、云端发布。

收尾 `node scripts/check-package.cjs --source` 通过48资源、生产依赖和1.3.3版本核对；`git -c core.safecrlf=false diff --check` 无空白错误。10份相关Markdown经现有Marked解析，127个本地文件目标均存在。最新生产构建可由根目录`.\run-experimental.cmd`启动；没有提交、推送或发布。

## 2026-11-17 至 18 专业技能、能力自动发现和可配置全局快捷键

### 本轮范围

版本保持1.3.3、schema9、政策修订号`2026-11-04.3`。本轮继续此前三模式实装，不重建框架或工作目录，保留已有脏工作树、图标和数据。主要改动如下：

- 五个Code入口及五份参考补齐任务契约、仓库定位、大型改动执行、故障取证、测试设计、前端与发布验收；Work流程及四份Office参考补齐受众、语气、论证、叙事、表格和版式质量门槛。公开资料、引用和不可复制边界分别见[Code调研](CODE_AGENT_RESEARCH_1.3.3.md)与[办公调研](OFFICE_AGENT_RESEARCH_1.3.3.md)，没有竞品私有技能复制或同模型付费A/B。
- `create_document.design`提供四种设计预设及三种密度；DOCX/PDF封面、段落层级、表格和callout；PPTX受控`slide.kind`、原生metric_grid/callout、内容带居中和图表混排；Excel报告表面及旧工作表`format_sheet`。保留显式坐标和旧稿SHA、权限、原子提交边界。
- Code/Work索引所有已安装且启用的Skill/插件元数据，手选项优先展开，`discover_capabilities`分页搜索后以精确ID调用`use_skill`，条件参考仍按相对路径/真实路径/链接/UTF-8/大小校验。停用插件的MCP声明和直接调用均受限，发现/读取不执行脚本或扩大权限；Chat完全不参与。
- 新增独立Chat小窗及10分钟滑动租约，首次和过期后下次唤起新建，未过期再次唤起续期，旧消息、已保存草稿和任务保留；读取状态不续期。沿用Chat上传只读问答、仅`web_search/web_fetch`、当前会话IPC和事件白名单。
- 设置 → 外观与语言 → 全局快捷键可逐项录制Ctrl/Shift/Alt组合，录入完成即实际注册保存；默认Ctrl+M和Ctrl+Alt+L。重复/Windows保留/不支持按键拒绝，Numpad不错误映射为主键区，非QWERTY字母使用实际key；占用、异常和持久化失败回退原绑定，界面显示真实状态。录制暂时释放本应用键，Esc/失焦/切页/卸载/迟到请求恢复，重启重新注册。`desktop.shortcuts`是现有app_settings，不新增schema。
- 两窗口草稿带`baseRevision`在savepoint内CAS比较，冲突不修改任何文字和附件，保留当前窗口并提供明确覆盖或重新载入。空正文、无附件且无通知引用的保存会删除服务端元数据，前端基准同步为null，避免清空后再输入出现假冲突。应用和store的退出flush等待全部操作settle再报告首个错误，不让先失败的草稿提前解除其他保存的锁。

### 检查、失败与重跑

```powershell
pnpm typecheck
pnpm lint
pnpm build
node scripts/check-package.cjs --source
pnpm --filter @mingshen/desktop exec vitest run --no-file-parallelism --reporter=dot
node scripts/quick-chat-smoke.mjs
pnpm audit --prod
```

- TypeScript Node/Web通过；Biome最新362文件通过（334ms）。中间新增草稿冲突class的条件换行未按格式器要求展开，Lint退出1；仅按Biome格式后重跑通过。
- 最新生产构建退出0：main126 / preload3 / renderer2248模块，25份TencentDB固定源哈希通过；main1472.91kB、CSS340.88kB。该构建包含空稿CAS修复，是源码生产构建，不是正式安装包。
- 源码预检退出0：57项资源、生产依赖和版本1.3.3核对。相较48项增加五份Code与四份Office参考，实际资源均在构建复制路径内。
- 较早完整串行运行141文件、138通过/3跳过，1775通过/14跳过（198.18秒）；随后完整串行运行142文件、139通过/3跳过，1789通过/14跳过（182.55秒）。后者早于最后两条空稿CAS回归及小窗冲突提示的CSS收口；不将数字相加或冒充其后重新执行。空稿修复另有两文件37项通过；全套草稿CAS、存储和会话相关曾五文件118项通过。快捷键核心/共享定向两文件26项通过，录制helper五项通过。
- 本轮首次完整串行在当时源码上退出1：140文件中135通过/2失败/3跳过，1738通过/15失败/14跳过（305.07秒）。14项是renderer mock未提供新草稿变更订阅；补齐后两文件32项通过。另1项是Windows junction创建EPERM；夹具区分inactive并存与链接，只有特定EPERM/EACCES允许环境跳过，实际独立junction成功后定向40项通过，domain技能3通过/1跳过。未放大全局超时来掩盖错误，旧失败记录保留。

### Office实机样例

```powershell
$env:OFFICE_CRAFT_EVIDENCE = 'C:\Users\ASUS\Desktop\MingshenHarness\.impeccable\review\v133-office-craft-1794920209360'
$env:OFFICE_CRAFT_RENDER = '1'
pnpm --filter @mingshen/desktop exec vitest run src/main/documents/office-craft-fixtures.test.ts --reporter=dot
```

夹具生成和实机回执测试1项通过（39.67秒），不等于三种Office全部渲染通过：

- Word：`unavailable / OFFICE_IN_USE`，最后阶段为检查Office进程，源字节不变，0 PDF；没有接管或关闭用户Word，不用第52节历史验收替代本轮。
- Excel：`verified`，隔离副本重算并保存缓存，生成26,598字节PDF，1页；源字节不变。
- PowerPoint：`verified`，只读隔离副本导出54,127字节PDF，7页；源字节不变。
- 使用已有unpdf与canvas运行时把PDF转换为页面图，`rendered-pages/xlsx-page-1.png`及`pptx-slide-1.png`至`pptx-slide-7.png`均已实际逐页打开查看；表头、公式、图表+callout混排、statement、cards、timeline和KPI内容带可读，未发现阻断性裁切或相互遮挡。首次转换在Excel后因调用不存在的`.destroy()`失败，移除该清理调用后完成全部页面，不把首次失败记为完整转换。

此处Excel仅是三行报告夹具，PPT也是固定七页；它们证明原生版式、重算/渲染和具体页面，不证明复杂财务模型、任意旧稿、所有Office版本或竞品效果达到相同质量。详细SHA与源不变检查在同目录`render-receipts.json`，页索引在`page-render-index.json`。

### 依赖审计和交付边界

`pnpm audit --prod`于2026-11-18退出1，报告3项moderate：ExcelJS传递的uuid缓冲边界问题，以及browserdo-mcp → MCP SDK → @hono/node-server的WebSocket升级ECONNRESET崩溃和反斜杠路径解析问题。没有把审计写成通过，也没有在本轮用未经兼容验证的跨主版本override强行清除报告；后续依赖更新须单独验证。

没有生成或验证正式NSIS/ZIP、安装/升级、云SQL、Git提交/推送、付费模型或正常用户profile/Key。原生Office只操作生成夹具和隔离副本，不批量关闭用户进程。实验入口仍为正常退出旧实验实例后执行`.\run-experimental.cmd`。Markdown与最终桌面证据补充在下文，历史数字和失败不被覆盖。

### 最终全量与快捷窗口验收

最后完整串行Vitest（session `42644`）退出0：**139文件通过/3文件跳过，1791项通过/14项跳过**，08:38:57开始，155.97秒。该轮已包含清空草稿后继续输入、删除最后附件后再输入的两条CAS回归，以及快捷窗口冲突提示的最终布局；之后仅补齐快捷Chat的英文附件、输入提示及相邻空状态词条，没有再次执行完整套件，也不与前轮数字相加。

上述翻译补齐后重新执行Node/Web类型检查、Biome362文件（328ms）、生产构建main126/preload3/renderer2248模块及25份TencentDB固定源哈希，均退出0。最新main1472.91kB、renderer JS2473.06kB、CSS340.88kB；源码预检57项资源、生产依赖和1.3.3版本核对通过。未生成正式安装包。

最终`node scripts/quick-chat-smoke.mjs`退出0：**22组通过、1组环境条件跳过、21张截图、3次本地模拟Responses请求、0 renderer异常、8次预期安全拒绝**。证据目录：

```text
.impeccable/review/v133-quick-chat-1794962800041/
```

覆盖独立小窗与缺模型状态、10分钟租约的复用/续期及并发新建、两窗口草稿同步/CAS冲突显式恢复/清空后继续输入、当前会话元数据隔离、长Markdown流式响应与停止、图片上传字节、仅web工具和IPC白名单、主窗口/托盘同路径切换、真实注册占用与重复绑定回退、按配置显示标题栏警告、Esc取消录制、修饰键录制、默认恢复、自定义配置重启后重新注册，以及正常重启保留会话和租约。过期边界由定向单测覆盖，桌面流程没有真实等待十分钟；模型为隔离本地模拟，不访问用户Key或收费供应商。

实际占用测试使用另一项真实系统注册预留`Ctrl+Shift+F4`；录制通过Chromium CDP键盘事件录入`Ctrl+Shift+F6`，失败后原绑定仍有效。默认`Ctrl+Alt+L`在本机已有实例下不可用，界面如实显示占用，不结束该实例；随后成功注册`Ctrl+Shift+F10`和`Ctrl+Alt+Shift+F11`，重启确认两项均恢复。

本轮Windows原生按键注入未得到回调：同进程独立的Electron `globalShortcut`探针真实注册成功，但注入后回调计数仍为0。因此脚本明确跳过原生按键唤起，不把CDP录制或直接桌面动作当成原生快捷键唤起通过。探针若能收到按键而应用快捷键失败，流程仍会失败。较早同实现`.impeccable/review/v133-quick-chat-1794960125594/`为20/20组通过、16截图，曾实际完成Windows按键唤起和托盘切换；这是对应轮次证据，不能替代最新轮的未验证项。

保留桌面失败历史：`1794960726144`与`1794960941313`在原生录制阶段未收到keydown并超时，后续`1794961244834`等原生唤起轮次也超时；定位后增加独立系统探针并改用CDP验证renderer录制。`1794961977775`在英文选择器预期`New chat`时失败，实际文案是`New conversation`，修正测试选择器后`1794962255916`及最终本轮均22组通过/1组环境跳过。最终补齐英文输入提示和附件标签后重建重跑，没有以早期截图替代翻译结果。

实际查看最新光轨英文800px设置、400px小窗夜间、580px小窗日间和简约占用错误截图；也已查看此前同布局的简约日夜、自定义设置、长内容与草稿冲突截图。无阻断性重叠、裁切或水平溢出；冲突恢复按钮实测底边668px，小窗高680px。独立源码/文档复核未发现P1/P2阻断。Office本轮仍以此前8页目视及Word占用降级为准，依赖审计3项moderate仍未修复，均不因本次快捷窗口通过而改变结论。

最终11份相关Markdown通过现有Marked解析，135个本地文件目标均存在；`git -c core.safecrlf=false diff --check`无空白错误。已构建源码继续由根目录`run-experimental.cmd`启动。

## 2026-11-18 本地插件开发市场、创建器与后台协作

### 实装范围

本轮版本仍为1.3.3，schema9、政策修订号`2026-11-04.3`、原子图标和用户数据目录保留。完整插件合同与手动步骤见[本地插件接口](LOCAL_PLUGINS.md)，开发交接见[AGENT.md](../AGENT.md)第56节。

- 原生`.mingshen-plugin/plugin.json`支持Skill、命令、MCP和受控Hook，兼容Codex、ZCode及根目录清单。设置中的本地开发市场支持添加、刷新、目录校验、安装、启停、更新和MCP同步重试；安装保存独立副本，不热同步源码。
- 更新保留extension ID、启用状态及会话引用。复制后的副本在登记前重新校验名称、版本和SHA，来源按market ID与plugin name替换，避免删除重装后命中旧记录。Agent任务运行时拒绝安装/更新；正常退出且任务停止后只清理宿主管理的旧版本副本。
- 插件命令按`plugin-name:command`动态加载，用户/工作区命令优先。Hook只处理当前会话显式引用且启用的插件；常规动作还要求主Code/Work、host、full_access、可写Profile、信任项目和逐次审批，Shell另外默认关闭。UserPromptSubmit仅声明式上下文；Interrupt仅显式停止后的非阻塞prompt活动，最多约1.5秒，不执行command/MCP或恢复工具，不要求项目信任。未知事件拒绝，不可执行的声明有结构化警告。
- 默认提供SkillCreator、PluginCreator及Harness接口技能，免依赖SDK可创建、预检和生成市场清单；SDK返回`authoritative:false`，宿主校验才是权威结果。模型`local_plugin`仅支持inspect/validate/list_markets，安装、更新和启停仍由用户在设置完成，Chat及实际子Agent不开放该工具。
- 用户Work技能流按最新七组92份SKILL加六个独立入口记录，共98份物理正文、93个名称、98个唯一SHA；对应19个原创领域工作流和按需参考，不是98个原版技能直接注册。设计资源361文件/4,809,702字节，74个骨架及8个子技能共82个资源入口，保留许可；Office/PDF许可冲突或专有正文/脚本采用原创能力适配。
- SubAgent移除十分钟总运行截止，spawn立即返回，主Agent可继续独立工作，显式wait或结束前补收结果。父取消、停止、退出和单次工具/网络/模型保护保留；已完成记录的十分钟保留期不构成运行期限。
- Quick Chat快捷键再次按下隐藏，再按显示；Pin同步真实AlwaysOnTop并跨重启保存。显示/隐藏/toggle统一队列处理，覆盖迟到载入和激活失败恢复。快捷键支持Ctrl+Alt三键与Ctrl+Alt+Shift四键，处理Windows AltGraph标记；光轨警告图标固定居中，窄窗隐藏会与模式按钮重叠的装饰标识。

### 自动检查和失败历史

```powershell
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @mingshen/desktop exec vitest run --no-file-parallelism --reporter=dot
$taskScriptTests = @(Get-ChildItem -LiteralPath scripts -File | Where-Object { $_.Name -match '\.test\.(cjs|mjs)$' } | ForEach-Object { $_.FullName })
& node --test @taskScriptTests
node scripts/local-plugin-sdk-smoke.mjs
node scripts/check-package.cjs --source
```

- 第一轮冻结运行时代码后的完整串行Vitest（session15699）退出0：**141文件通过/3文件跳过，1843项通过/15项跳过**，12:48:20开始，217.88秒。这是最后MCP Hook项目信任补查之前的基线；最终补查后的完整结果继续记录在本节末尾，不把多轮数字相加。
- Node脚本测试10文件**73/73通过**，26.49秒，包含真实生成的ASAR测试夹具、文档运行时、ExcelJS缺失资源检查和打包脚本回归；这些不是产品正式ASAR或安装器验收。
- SDK smoke **8组通过**，覆盖创建、TODO拒绝、命令目录/映射/JSON、路径边界、UTF-8、大小、marketplace及版本更新。SDK非权威边界保留，后述Electron流程另验证真实`local_plugin validate`。
- 窄窗收口后Node/Web TypeScript通过，Biome **370文件通过（426ms）**；生产构建main130/preload3/renderer2250模块及25份TencentDB固定源哈希通过。产物main1552.33kB、preload29.75kB、renderer JS2515.16kB、CSS354.87kB。最后Hook补查后重新构建结果见本节末尾。
- 资源预检包含453项资源、生产依赖和1.3.3版本，递归检查内置技能、82设计入口及封包副本哈希。最终文档与资源检查结果继续追加，不以源码预检冒充正式安装包。

保留本轮失败及修复依据：

- 首轮完整串行session99383退出1：140文件通过/1失败/3跳过，1830项通过/3失败/15跳过，277.75秒。`agent-questions`夹具在异步PreToolUse完成前读取broker，并过早停止；改用`QuestionBroker.onChange`等待真实问题登记，单文件4/4通过，未加入任意sleep或扩大超时。
- 中间session3541于12:40:01启动，最后Hook源码/回归于12:40:18落入，混合修订运行出现2项嵌套伪prompt遍历失败：140文件通过/1失败/3跳过，1841项通过/2失败/15跳过，256.37秒。最终源码定向13/13通过，随后冻结完整套件通过；不将它归因为无法解释的随机失败。
- Node初次套件64通过/8失败，定位为打包文档夹具未提供新增ExcelJS依赖，以及resolver夹具对不存在模块返回undefined而非抛错。修正夹具并新增缺XLSX运行时的ASAR回归后，定向10/10及完整73/73通过。
- 退出清理新增判断曾触发一处Biome格式失败，按格式修正后全量Lint通过。
- 最终文档复核发现MCP Hook尚未执行文档承诺的项目信任检查，已补齐动作前校验及未信任项目不审批、不调用MCP的回归，目标14/14通过。另修正Interrupt声明式通知不要求信任的文档，并移除SkillCreator中不存在的模型生命周期安装工具描述；三项经独立只读复核确认，最终完整结果见本节末尾。

### 快捷窗口与原生快捷键

```powershell
node scripts/quick-chat-smoke.mjs
```

隔离Electron专项退出0：**30/30组、0跳过、24截图、3次本地Responses请求、0 renderer异常、8次预期安全拒绝**。证据：

```text
.impeccable/review/v133-quick-chat-1794977002241/
```

实测覆盖10分钟滑动租约、两窗口草稿CAS及恢复、只读上传、IPC白名单、并发toggle/show/hide顺序、show→hide→show、hide→show、renderer崩溃后的激活失败和重试、Pin真实窗口状态与重启持久化、占用回退及快捷键重注册。桌面没有真实等待十分钟，租约过期边界由定向单测覆盖。

本轮Windows全局注入探针实际收到1次回调，应用Quick Chat快捷键3次、主窗口切换2次，确实完成显示→隐藏→显示和主窗口/托盘切换。CDP录制器分别录入Ctrl+Alt+K和Ctrl+Alt+Shift+F12；本轮事件AltGraph为false，Windows同时Ctrl+Alt且AltGraph为true另有单测覆盖。没有用IPC直接设置或CDP录制冒充原生全局快捷键唤起。前轮原生注入跳过仍是对应轮次历史，不适用于本轮实际通过结果。

光轨警告容器32×36、简约34×34，图标中心偏差不超过1px。实际查看光轨1440警告、800英文设置、小窗480置顶与400光轨夜间截图，无阻断性遮挡。新增崩溃测试首跑`1794976801766`在测试helper读取尚未载入窗口的空URL时失败；修正加载期窗口枚举及崩溃定位后完成上述30组，未修改为跳过。

### 本地插件真实桌面生命周期

```powershell
node scripts/local-plugin-smoke.mjs
```

窄窗收口后的专项退出0：**9/9组、23次本地Responses请求、2次实际Hook审批、5次预期Chat工具拒绝、7张截图、0 renderer异常**。证据：

```text
.impeccable/review/v133-local-plugins-1794978876359/
```

真实Settings UI完成校验、添加市场、安装、启停、刷新、V0.1.0→V0.2.0更新和正常重启。主Code实际发现并加载精确Skill、调用只读`local_plugin validate/list_markets`、启动已安装插件的stdio MCP子进程、执行经审批PostToolUse MCP Hook，并通过sendChat展开插件命令。禁用后Skill/MCP/命令/prompt Hook共同受限；更新保留extension ID、禁用状态及会话引用，重启后重新启用加载新版本。正常退出时旧安装副本清除、当前副本存在。Chat只获得web_search/web_fetch，并拒绝发现、Skill、local_plugin、插件MCP和本地文件调用。

较早两次失败仅为smoke断言错误：`1794977341739`误将discover返回的查询回显当成匹配结果，改为解析结构化`total:0,matches:[]`；`1794977541807`误期望`listSessionExtensions`返回已全局禁用插件，修正为验证停用时过滤、重新启用后会话引用仍在。没有为通过测试而改掉生产过滤行为。

中间`1794977925975`功能9组已通过，但目视发现800px长路径撑出设置页内部横向滚动、光轨顶部装饰标识与模式按钮重叠及首段英文缺词条。最后约束flex/grid最小宽度、路径收缩及窄窗换行，补齐英文并隐藏≤1280px装饰标识；增强脚本同时检查document、设置滚动容器和marketplace内部宽度后重建重跑。

最终Simple800的设置容器590/590、插件区550/550；Orbit英文800分别565/565、525/525（clientWidth/scrollWidth）。实际查看Simple800、Orbit英文800及Orbit1440日间截图，路径省略、操作与校验按钮完整，没有内部横向滚动。没有以仅document无溢出代替内部容器检查。上述专项早于最后Hook项目信任补查，最终重跑见本节末尾。

### 三模式与Office回归

```powershell
node scripts/agent-modes-smoke.mjs
```

最终退出0：**11/11组、21次本地Responses请求、11张界面截图、0 renderer异常**。证据：

```text
.impeccable/review/v133-agent-modes-1794978939868/
```

覆盖Code/Work共享会话及目录、运行/附件准备/重发准备期间前后端切换锁、手动停止、局部检查点、90k命令输出按call ID恢复，Chat独立界面与分组管理、五种真实上传格式、恶意本地/Skill/MCP/子Agent拒绝，以及正常重启持久化。实际查看最新光轨1440日间Chat及800夜间Chat，输入框完整、顶部无重叠。

Work按需加载Excel工作流、结构化生成和inspect公式，真实Microsoft Excel在隔离副本重算`42*2=84`并导出PDF。唯一页面返回模型的tool_result并进入后续Responses的input_image；`office-page-1.png`已实际查看，数值和文字可读。这是两行最小夹具，不证明复杂报表美观或所有公式兼容。前轮七页PPT和Excel报告逐页验收仍按原证据记录；本轮没有重新声称Word通过，既有Word占用降级和更早Open阻塞边界保留，不关闭用户Office来获得测试结果。

### 文档与交付边界

README、中英文手册/更新日志、安全说明、第三方来源、SDK和Creator指引已同步。根AGENT第56节记录实际合同与数量；未把用户提供参考中的私有接口或指令作为运行授权。

`pnpm audit --prod`仍退出1并报告3项moderate，来源为ExcelJS→uuid及browserdo-mcp→MCP SDK→@hono/node-server的两项问题，未用未经兼容验证的跨主版本override掩盖。Word本轮实机未验收、复杂Office兼容矩阵、任意第三方ZCode插件及远端服务均不由本轮夹具保证。

本轮仅源码构建和隔离profile验收，没有正式NSIS/ZIP、安装/升级、云SQL、付费模型请求、正常用户DB/Key访问、提交、推送或发布。已构建源码的实验入口仍为根目录`run-experimental.cmd`；最终资源与文档收尾结果继续追加在本节末尾。

### 最终冻结结果

MCP Hook信任补查及Creator说明修正后，完整串行Vitest（session36167）退出0：**141文件通过/3文件跳过，1844项通过/15项跳过**，13:32:38开始，236.97秒。该轮包含新增未信任项目拒绝MCP Hook的回归，之后只更新验证与交接文档，没有再改运行时代码。

最后Node/Web类型检查通过；Biome370文件通过（625ms）；源码资源预检453项资源、生产依赖及版本1.3.3通过。生产构建main130/preload3/renderer2250模块、25份TencentDB固定源哈希通过；main1552.66kB、preload29.75kB、renderer JS2515.16kB、CSS354.87kB。SDK与两份快捷/插件smoke脚本语法检查通过。

使用这份最终构建重新执行`node scripts/local-plugin-smoke.mjs`退出0：**9/9组、23次本地Responses请求、2次实际Hook审批、5次预期Chat工具拒绝、7截图、0 renderer异常**。最终证据目录：

```text
.impeccable/review/v133-local-plugins-1794980255768/
```

已信任项目的MCP Hook正常审批并执行；未信任项目不查询Server、不审批、不调用MCP由最终完整套件中的专项测试覆盖。安装/更新、禁用、会话引用、正常重启、旧副本清理和内部宽度断言全部通过，800px各容器宽度与前轮一致；实际查看最终英文光轨800px截图，无阻断性遮挡或横向滚动。快捷窗口30组及三模式11组证据继续使用上文对应轮次；最后修改仅为MCP Hook信任校验和Creator文案，不将它们伪称为重新执行。

收尾20份相关Markdown通过现有Marked解析，150个本地文件目标全部存在；`git -c core.safecrlf=false diff --check`通过。3项moderate依赖、Word占用与复杂Office/第三方服务未验收边界保持明确，没有因完整测试通过而改写成已验证。

## 2026-11-18 内置能力发现与 Work 全量技能复核

### 插件创建后的发现和校验链路

`discover_capabilities`现在把Code/Work内置基础技能与已安装启用扩展合并后统一过滤、排序和分页；内置Work来源只在Work会话出现，Code不加载，Chat继续禁用发现和Skill。`local_plugin`在主Code/Work、host执行且有工作区的完全访问及请求批准会话中提供，只允许`inspect`、`validate`和`list_markets`。请求批准按canonical插件目录审批，审批后重新检查工作区边界、链接和真实路径；Chat、实际SubAgent、Docker及worktree仍拒绝。安装、更新和启停没有模型工具，继续由用户在设置的本地插件开发市场手动完成。

SDK和系统Node不再是宿主校验前提。Creator报文明确SDK路径可能不在沙箱PATH或不可读，工作区内插件源码以宿主`local_plugin`预检为权威；SDK只作可选的非权威CLI检查。

### WorkAgentSkill 全树

以前文“98份”为历史盘点。真实`WorkAgentSkill/`全树为**124个物理`SKILL.md`、104个不同源正文SHA、93个frontmatter名称、82个设计资源入口**。生成后的[catalog](../apps/desktop/resources/prompts/skills/work-sources/catalog.json)有124个唯一ID；所有`entry`与`resourceRoot`都相对`apps/desktop/resources/prompts/skills`，没有多余的`skills/`前缀，ID不含点号且以各自源SHA-8结尾。完整逐项映射见[inventory](../apps/desktop/resources/prompts/skills/work-sources/inventory.md)。

- PDF相关共10个物理入口、5个不同源正文：`pdf-1/0.2.3/skills/pdf/SKILL.md`（`0016a97a…`）、`pdf-1/0.2.3/skills/pdf-viewer/SKILL.md`（`7552e6cc…`）、`pdf-reading/SKILL.md`（`e2081f07…`）、`pdf/SKILL.md`（`d1c7caf5…`）及单独保留的历史Viewer 0.2.1（`430308a5…`）。
- 相同正文的历史版本共享资源正文但不合并入口；每个物理`sourcePath`保留独立稳定ID、版本、原始SHA、许可处理及资源根。
- PDF适配正文已按当前真实接口修正为`read_document`行窗口、`char_offset`、续读游标、`render:true`页图及工具实际返回的`[Page N]`标签，不再声称支持不存在的页范围或页锚点参数。通用说明也区分了未复制的私有Viewer/API/JWT与获许可、只读打包且不执行的支持资源。
- Work来源默认可发现，由`use_skill`按需加载，不会把124份正文全部塞进每轮提示词。宿主私有JWT、Viewer/Canvas API、插件服务和冲突许可脚本不因目录内置而获得执行权限。

### 本轮检查结果

```powershell
node apps/desktop/resources/prompts/skills/work-sources/build.cjs
node --test scripts/work-skill-inventory.test.cjs
pnpm --filter @mingshen/desktop exec vitest run src/main/agents/domain-skills.test.ts src/main/extensions/extension-service.test.ts src/main/chat/agent-specialization.test.ts src/main/chat/local-plugin-tool.test.ts --no-file-parallelism --reporter=dot
pnpm --filter @mingshen/desktop typecheck
pnpm --filter @mingshen/desktop exec biome check src/main/agents/domain-skills.ts src/main/agents/domain-skills.test.ts src/main/extensions/extension-service.ts src/main/extensions/extension-service.test.ts src/main/chat/chat-service.ts src/main/chat/local-plugin-tool.test.ts
pnpm --filter @mingshen/desktop package:check
```

- Catalog生成：124来源、82设计资源、104唯一SHA、93名称、5个PDF唯一正文；连续生成catalog SHA-256稳定为`c5937d1fce55b1cbde2d272016fa961175b918e489d2f3e34ff92ce94257e9e7`。
- 真实catalog smoke逐条执行124次Work加载、124次Code拒绝、124次Chat拒绝和104个唯一`resourceRoot`的`SOURCE.md`读取；同时核对分页恰好返回124个唯一ID。设计82资源读取和PDF 10物理/5正文断言通过。
- Work来源定向Vitest文件：10项通过、1项目录链接测试按Windows环境跳过。含插件发现、创建器隔离和`local_plugin`边界的四个目标文件共47项通过、1项环境跳过。
- Work来源盘点/失效夹具15项通过；TypeScript通过；目标6文件Biome通过；`git diff --check`通过；源码打包预检通过，共核验**763个资源**、生产依赖和1.3.3版本。

本轮未运行完整Vitest、生产构建或新的Electron界面专项；这些由冻结后的统一收尾执行。源码与资源测试通过不能替代最终安装包、真实设置页安装或第三方插件兼容验收。

## 2026-11-18 插件开发故障修复与 Work 全版本技能补齐

### 范围和核对口径

用户截图中的实际问题为：内置创建器可加载但能力发现结果为空，受保护会话缺少`local_plugin`，依赖系统Node/安装目录SDK的指导在沙箱中无法执行。另要求`WorkAgentSkill/`所有同名或历史版本都进入Work内置目录。保持版本1.3.3、schema9及政策修订号`2026-11-04.3`，不改正式发布、图标和正常用户数据。

- 统一发现入口合并内置技能与已安装启用扩展，然后按种类、查询及会话优先级分页。Code有9个基础入口，Work有14个基础入口加124个来源；用户安装的启用扩展另外计数，Chat仍无发现或技能加载权限。
- 主Code/Work宿主会话的请求批准和完全访问模式都可调用只读`local_plugin inspect/validate/list_markets`。校验通过主进程运行，无系统Node、PATH或安装目录SDK子进程前提；源目录须在工作区内，受Profile读取规则、canonical路径、审批及链接约束。审批后重验路径，取消传到扫描/读取/哈希，Chat、实际子Agent、Docker、worktree仍拒绝。
- 安装、更新、启用和停用继续由用户在设置完成。Creator会提供实际市场路径、权威校验状态和手动步骤，并结束生成任务，避免活动任务占用导致安装被拒绝。
- 全树实际124个物理`SKILL.md`、104个不同源正文SHA、93个名称；此前98份只统计latest系列及独立入口，遗漏26个历史文件。每个物理路径有独立ID，正文相同可共用资源。82个设计参考原始副本保留字节和许可，22个其余不同源正文使用原创适配，来源入口及参考按需读取。PDF含10个物理来源、5个不同源正文，覆盖四类流程和历史Viewer差异。
- [机器目录](../apps/desktop/resources/prompts/skills/work-sources/catalog.json)与[逐项来源清单](../apps/desktop/resources/prompts/skills/work-sources/inventory.md)随包保存；生产运行不依赖仓库外层`WorkAgentSkill/`。完整登记或文本加载通过不等于全部上游私有API、脚本及远端服务均已实现或验收。

以下结果仅记录本轮实际执行，不用上一节1844项或旧桌面截图代替本次验证。

### 冻结后的源码、资源与构建

```powershell
pnpm typecheck
pnpm lint
pnpm --filter @mingshen/desktop exec vitest run --no-file-parallelism --reporter=dot
node --test scripts/*.test.cjs
node scripts/local-plugin-sdk-smoke.mjs
node scripts/check-package.cjs --source
pnpm build
```

- Node/Web TypeScript通过，Biome检查370文件通过（498ms）。
- 完整串行Vitest最终退出0：**141文件通过/3文件跳过，1855项通过/14项跳过（1869项）**；16:28:53开始，179.88秒。包含本轮内置发现、全部来源加载、Profile权限、Windows目录链接审批竞态及中途取消回归。
- Node脚本完整套件11文件**89/89项通过**（22.88秒）；其中Work来源盘点与失效夹具最终16/16通过。SDK smoke八组通过，其结果仍为可选预检，不替代真实宿主校验。
- 定向四文件另有90项通过/1项Windows环境跳过，不与全量数字累加。真实Work逐个加载124入口；Code及Chat逐条拒绝；104个不同资源根的`SOURCE.md`、82个设计资源路由和PDF 10来源/5正文均通过。
- 独立磁盘集合对账再次确认124个物理源与124个catalog入口一一映射：未映射源、幽灵路径、重复路径、SHA/名称不一致、缺失/空入口及缺失资源根均为0。82份设计原始正文SHA全部一致；99份只读支持文件均能对应源树字节，唯一零字节为Python包标记`scripts/__init__.py`。
- 源码资源预检**763个资源**、生产依赖及版本1.3.3通过；完整生成后的catalog SHA-256仍为`c5937d1fce55b1cbde2d272016fa961175b918e489d2f3e34ff92ce94257e9e7`。生产运行无需外层来源目录。
- `pnpm build`退出0：main130/preload3/renderer2250模块，25份TencentDB固定源哈希通过；main1568.83kB、preload29.75kB、renderer JS2515.16kB、CSS354.87kB。之后只调整smoke夹具和验证文档，没有再修改运行时代码或打包资源。

### 最终真实Electron专项

```powershell
node scripts/local-plugin-smoke.mjs
```

最终退出0：**16/16组、89次本地合成Responses请求、4次实际审批（2次只读校验的允许/拒绝及2次MCP Hook）、6次预期Chat工具拒绝、9张截图、0 renderer异常**。证据：

```text
.impeccable/review/v133-local-plugins-1794992595490/
```

- 未安装任何fixture插件、未注册任何fixture市场时，Code与Work均发现三个内置创建器。
- 受保护Work主会话在清空主进程PATH后仍可发现、加载内置Word流程，并由宿主完成`local_plugin validate`。允许读取返回`readOnly:true`、`lifecycleChanged:false`及成功校验；拒绝读取回显拒绝反馈、不返回validation，双方均没有启动插件MCP。拒绝后不进入扫描由相邻单元测试补充验证。
- Work来源分3页得到124个不同ID及104个不同源SHA；PDF查询分页找到10个来源，按精确ID真实加载5个不同正文，包含历史Viewer 0.2.1与当前Viewer。同SHA历史入口及Word、Excel、PPT、viewer、design样例可独立加载；Code不可发现或加载Work来源。
- 真实设置页完成校验、添加市场、安装、启停、更新与正常重启；extension ID、禁用状态和会话引用保留。Skill、stdio MCP、命令与审批Hook均执行，停用同时阻断发现及直接使用；退出清理旧安装副本。Chat仅收到`web_search/web_fetch`，六种越权调用均拒绝。
- 布局检查同时覆盖document、设置滚动容器及市场内部宽度。Simple800为590/590与550/550，Orbit英文800为565/565与525/525（clientWidth/scrollWidth）。等待有限动画结束、两帧绘制及前景命中后采集；实际查看最终光轨1440日/夜、800英文及读取审批截图，无阻断性遮挡和横向溢出。

### 失败记录与夹具修正

- 首轮Node套件88/89，零字节资源例外在交错修改时过宽。已限制为来源入口下非`SKILL.md`支持文件，基础技能和所有`SKILL.md`仍必须非空；补充负向断言后完整89/89通过。
- 首轮完整Vitest为1854通过/1失败/14跳过，失败是旧测试只期望`discoverCapabilities`两个参数；实际新增第三参数为内置记录。改为同时断言三个内置创建器后，最终完整1855项通过。
- 前期生成目录检查发现ID点号、资源路径重复`skills/`及元数据描述截断，均已在最终生成和真实加载前修正，未绕过路径规则。
- 桌面`1794990840562`与`1794991107054`因helper先改当前会话模式、再选目标行，将Work会话误改为Code，导致`SKILL_MODE_UNAVAILABLE`。现先选目标行，再切换，并同时等待UI状态和`getSession(id).agentMode`后端持久化；没有放宽技能模式限制。
- 桌面`1794991564519`与`1794991966645`的实际宿主校验已成功，失败为断言错误：插件路径在审批`summary`中，夹具错误检查通用`detail`。允许和拒绝两个断言均已按真实字段修正。
- 桌面`1794992148624`功能16组已通过，但目视发现光轨截图还停在前一画面，不能用于设置页视觉验收。补充前景激活、有限动画结束、两帧绘制及标题前景命中后重跑，最终目录`1794992595490`的市场截图已真实显示并逐张查看。

### 文档与边界

README、双语手册/更新日志、安全说明、第三方来源、本地插件合同、SDK/Creator和根AGENT第57节已同步。收尾23份相关Markdown通过现有Marked解析，282个本地链接目标均存在；smoke脚本语法及`git -c core.safecrlf=false diff --check`通过。根package、desktop package及release常量保持1.3.3，政策修订号保持`2026-11-04.3`。

本轮只做源码构建、临时profile、本地合成供应商和stdio MCP验收，没有正式NSIS/ZIP、安装/升级、云SQL、付费服务、正常用户DB/Key、提交或发布。来源完整登记与文本加载不等于所有上游私有Viewer/Canvas/JWT、任意Office/PDF编辑或脚本均可原样运行。前轮3项moderate传递依赖、Word占用降级及复杂Office/第三方服务未验收边界保留，本轮没有将它们改写成已验证。

## 2026-11-18 手动内置引用、PPTMaster / ASD-STE100与T3队列

### 实装合同

本轮保持1.3.3、schema9和政策修订号`2026-11-04.3`。用户要求自动发现之外也能手选内置Skill/Plugin，新增PPTMaster和ASD-STE100只属于Work，Code原技能范围保留，并研究T3 Code后落地可用功能。开发交接见[AGENT第58节](../AGENT.md)，研究来源和未实装候选见[T3 Code调研](T3_CODE_RESEARCH_1.3.3.md)。

- 输入框“+ 引用”提供内置Skills、内置Plugins、已安装Skills、已安装Plugins四组，搜索、多选及chip取消。来源路径、版本和SHA可区分同名PDF，持久化精确ID；内置合计最多32项。
- Profile允许且无需审批的手选Skill正文按总64,000字符预算预载；默认读取策略包含在内。ask、deny、不可用和超预算项延期，实际读取保持原权限。Code/Work切换隐藏并恢复Work-only选择，运行或准备中的会话及后代拒绝修改；Chat拒绝内置引用list/set。
- `builtin:plugin-github`与`builtin:plugin-browser`代表真实工具组，按Profile及实际可用工具过滤。手选只提供工具偏好，不把Plugin ID作为Skill加载、不连接账号、不启动浏览器或授予权限。已安装插件的命令、MCP及Hook边界保留。
- 新增`builtin:work-ppt-master`与`builtin:work-asd-ste100`；领域总表21项，Code基础仍9，Work基础16加旧来源124，两种模式另各有2个内置插件。旧catalog与PDF 10来源/5不同源正文保持。
- 主界面Code/Work/Chat忙碌时可加入下一轮队列，文字编辑、附件替换、删除和上下排序；完成、失败、停止及审批状态变化均不自动派发，必须点继续。8项/50MiB，配置快照改变阻断继续。发送前持久claim、同会话锁及发送接受后的清理共同防重放，异常待确认项可删除。QuickChat六组IPC拒绝，实际SubAgent拒绝add/continue，Chat工具范围不扩大。

### 新技能资源与许可核对

独立只读复核逐文件比较仓库源与包内副本，文件数量、总字节和树SHA一致，除明确排除的`.env.example`无源/包差异，无链接或空文件：

| 资源 | 文件数 | 字节 | 树SHA-256 |
| --- | ---: | ---: | --- |
| PPTMaster 6.9.0 | 13,089 | 39,892,466 | `6e8023b4b8ab81e0fb4cffb71c1dcea8dd4f6f6abca490395c21fb273bfe473c` |
| ASD-STE100 0.4.0 | 9 | 231,661 | `0886b021b0f18d8997736af0a3b51a3492dd2c3b378ebb7484bead7803e04930` |

两份MIT全文、作者版权、SOURCE及顶层第三方通知一致。PPTMaster保留12,027个SVG图标、186个CC0 WAV及各自NOTICE；Wrapper明确SVG可作文本读取，WAV不能经`use_skill`返回或播放。上游Python脚本、依赖及外部服务不会自动运行或安装；真实操作仍走当前任务授权、工作区、审批和隔离。`read_document`只提取PPTX幻灯片文字，结构、对象和备注检查使用`office_document inspect`，没有高估已有解析器。

ASD保留规则、示例及标准库linter，不含官方约900词字典，不宣称官方认证、由linter证明语义保真或自动执行。两个wrapper加入显式打包required守卫，避免正文误删但资源仍在时漏检。旧Work catalog SHA仍为`c5937d1fce55b1cbde2d272016fa961175b918e489d2f3e34ff92ce94257e9e7`。

### 冻结后的源码与构建

```powershell
pnpm typecheck
pnpm lint
pnpm --filter @mingshen/desktop exec vitest run --maxWorkers=1
$taskScriptTests = @(Get-ChildItem -LiteralPath scripts -File | Where-Object { $_.Name -match '\.test\.(cjs|mjs)$' } | ForEach-Object { $_.FullName })
& node --test @taskScriptTests
node scripts/local-plugin-sdk-smoke.mjs
node scripts/check-package.cjs --source
pnpm build
```

- 最新Node/Web TypeScript退出0，Biome **380文件通过（1261ms）**。
- 主Chat队列合同统一后的完整串行Vitest（session16201）退出0：**144文件通过/3跳过，1880项通过/14跳过（1894项）**，20:17:18开始，188.09秒。此前19:49:08的完整串行亦为144文件/1880项通过（240.21秒）；这些结果不累加，最终合同以前者为准。
- Node完整11脚本**89/89通过（34.23秒）**，SDK smoke八组通过；本轮最后队列改动没有修改Node脚本测试覆盖的实现。新增队列服务/手选能力/renderer helper和权限回归另有定向结果，不与完整数字相加。
- 源码资源预检**13,865资源**、生产依赖和1.3.3通过。两个新技能副本的独立SHA检查及旧Work来源盘点通过；源码预检不是正式安装包验收。
- 主Chat修正后的`pnpm build`退出0：25份TencentDB固定源哈希、main135/preload3/renderer2254模块通过；main1606.03kB、preload31.10kB、renderer JS2555.07kB、CSS359.02kB。

### 复核和失败记录

本轮保留发现与修正，不把中途失败改写为从未发生：

- 并行实现收口前曾有TypeScript未使用import、`parentSessionId`形状及Biome格式报错；当前完整typecheck/lint及冻结套件通过。
- 新增权限单测曾误用`read_file`作为“不允许读取Skill”的allowlist；该项按原合同允许`use_skill`继承读取能力，改为仅`run_command`并保留真实权限规则。定向17通过/1环境跳过及最终完整通过。
- 桌面前置复核发现主Chat队列在renderer/docs与service之间仍有旧限制，现主Code/Work/Chat均支持，QuickChat和实际SubAgent继续拒绝；定向3文件28项、类型检查、构建及最终完整套件通过。
- 插件桌面首跑`v133-local-plugins-1795003757668`已通过10组/73次本地请求，失败于断言把元数据中提及`CONTROLLED PINNED-SKILL CONTEXT`当成已预载正文；改为检查实际header和正文标记，不修改Profile权限以通过测试。该轮已真实手选PPTMaster、ASD、特定PDF版本和GitHub插件，最终完整重跑结果另记下文。
- 队列首次桌面运行时两份夹具并发争用9491/9492，出现目标会话事件等待或provider hold超时；已有Code队列六组流程通过，不能据此声称整套通过。后续改为唯一实例串行执行，最终结果另记下文。
- 队列隔离重跑`1795004816326`已完成Code六组，但夹具错误地从只含主会话的paged bootstrap等待子会话。改为等待真实`session_updated`子会话事件，再经`getSession`核验父子关系；`1795005722212`已实际完成SubAgent拒绝及Chat入队，随后因夹具仍保留已结束的Code模拟请求而释放错误response。清理已结束请求并绑定本轮hold后继续重跑，没有扩大超时或修改生产队列逻辑。
- 引用视觉补充首跑`1795005271432`在保存光轨偏好后直接等待新界面，遗漏产品要求的reload而超时。补齐reload、重新监听及选择同一会话，并在恢复原风格时使用同样流程；选择、权限和模式合同不变。
- `1795006515420`的预算夹具在超过120k时停止选取却要求大于128k，断言相互冲突。改为构造真实超过64k的输入，并逐项对照loaded/deferred及总字符预算；后续实际选18项、100,810字符，加载11项62,515字符、延期7项。`1795006925477`进一步误期望当前已选模式按钮也disabled，按真实合同检查其他两种模式被锁、当前模式仍selected，并新增直接IPC切换拒绝验证。
- `1795007429172`已完成24组，包括重启引用、64k预算、Mode隔离、插件更新和全部Chat工具拒绝；最后夹具重载后停留Code页面，等待独立Chat行而超时。补齐真实主界面模式按钮切页后继续整套重跑，不放宽Chat的能力边界。
- 队列`1795006397601`已完整10组通过，但目视800px截图时右侧响应式抽屉仍打开，遮住队列。补充用真实关闭抽屉控件后拍摄，并增加队列前景命中与纵向完整可见断言；早期截图不用于声称无遮挡。
- 只读审查起初提出准备态模式切换缺口；Root复查`main/index.ts`发现IPC已有递归`chatService.isSessionBusy`守卫，包含preparing并先于SessionService执行，因此未增加重复注入。内置引用目录异步读取后的模式/忙碌重验另有专门覆盖。

界面检查使用impeccable的既有DESIGN上下文及一次manual detector；检测结果仅有历史styles.css的30项建议，未为无关旧样式扩展重构范围。新增引用和队列界面仍以真实渲染截图及尺寸检查为准，不以源码静态检查代替。

完整套件后仅修正引用面板三个空状态的英文分组插值，避免英文界面仍显示中文分组名；重新Node/Web类型检查、Biome380文件和生产构建通过。main/preload模块及产物不变，renderer仍2254模块、JS2555.08kB、CSS359.02kB。完整1880项结果属于该文案修正前的功能冻结，最终两份Electron验收使用文案修正后的构建，未再重复完整套件。

本轮没有正式NSIS/ZIP、安装/升级、云SQL、付费模型、正常用户DB/Key操作、提交或发布。PPTMaster全Python流水线、复杂Office质量矩阵及官方ASD认证未验收，前轮Word占用与3项moderate传递依赖边界保留。实验入口为根目录`run-experimental.cmd`。

### 最终内置引用与插件桌面专项

```powershell
node scripts/local-plugin-smoke.mjs
```

最终退出0：**26/26组、104次本地合成Responses请求、4次实际审批（只读校验允许/拒绝及两次MCP Hook）、15张截图、0 renderer异常**。证据：

```text
.impeccable/review/v133-local-plugins-1795007753673/
```

- 实际输入框选中PPTMaster、ASD-STE100和PDF Viewer 0.2.1，取消后换为0.2.2；服务保留精确ID、原始路径及SHA。首个真实provider请求预载两个新基础正文和被选PDF正文，未误混历史Viewer正文。
- 实际UI选择和取消GitHub内置插件，模型收到精确ID、可用GitHub工具偏好及不能对插件ID调用`use_skill`的说明；工具清单未扩大。恶意`use_skill`插件ID返回`SKILL_NOT_FOUND`。
- Profile默认读取可预载，按ID的ask/deny只保留延期元数据，排除读取的allowlist不泄漏正文。18项选择、100,810字符输入下预载11项/62,515字符、延期7项，与精确预算逐项一致；延期不丢持久选择。
- 运行中引用菜单和chips锁定、其他模式按钮禁用，直接IPC修改引用及切换模式均拒绝。手动停止后恢复；Work→Code隐藏Work-only引用，Code模型请求不包含这些ID或正文，切回Work恢复，正常Electron重启保留。
- 真实设置完成市场校验、安装、停用、刷新和更新；extension ID、启用状态与会话引用保持，已安装Skill、命令、stdio MCP及经审批Hook执行。退出只清理宿主管理的旧安装副本，当前副本保留。
- Work目录16基础/124来源/104不同源SHA、Code9基础，以及两模式各2个内置插件均与实际发现分页一致；PDF 10来源、5不同源正文实际加载。Chat拒绝引用list/set、Skills、来源、插件、命令、MCP和本地工具，provider只收到`web_search/web_fetch`。
- 新引用面板1440日夜、800英文、同名PDF版本、插件选中态及混合chips均有真实截图并实际查看。Picker宽430px，内部429/429，搜索409/409，内容419/419（client/scroll）；混合chips647/647。设置市场Simple800为590/590及550/550，Orbit800为565/565及525/525，无内部横向溢出。窄窗背后的响应式工作区抽屉可存在，Picker本身前景命中且完整可见。

最终截图确认英文空状态使用翻译后的分组名，同名PDF的版本、路径和指纹可辨认；未为历史样式建议扩大重构。

### 最终下一轮队列桌面专项

```powershell
node scripts/queued-prompt-smoke.mjs
```

最终退出0：**10/10组、10次本地合成Responses请求、7张截图、0 renderer异常**，另有9次预期IPC拒绝。证据：

```text
.impeccable/review/v133-queued-prompts-1795008343768/
```

- 真实Code输入框运行中加入三份草稿，编辑、取消、排序、替换附件和删除后，UI与后端顺序、文字及附件元数据一致。当前任务结束和手动Stop都保留队列，没有自动新增模型请求。
- 正常Electron重启保留队列顺序、文字、附件元数据及显式继续状态。点击指定条目的继续仅派发一次，provider收到编辑后的精确文字和替换后的附件字节；已派发条目出队，其他条目保留。
- 配置快照变化时UI禁止继续，直接IPC再次返回`QUEUED_PROMPT_CONFIGURATION_CHANGED`。空闲会话直接入队同样被拒绝，未绕过运行中才能入队的合同。
- 通过真实模型工具调用`spawn_subagent`创建实际子会话，主进程在创建队列记录前返回`QUEUED_PROMPT_UNSUPPORTED_SUBAGENT`。主Chat页面真实入队并显式继续，恶意`read_file`得到`CHAT_TOOL_DENIED`，provider仍只收到`web_search/web_fetch`。
- 快捷Chat窗口的list/add/update/reorder/remove/continue六组IPC全部在主服务之前拒绝，没有因主Chat支持队列而扩大快捷窗口权限。
- 实际查看忙碌Chat、光轨1440日间及800英文夜间截图，队列位于输入区域、文本和操作完整可见。拍摄前通过真实遮罩控件依次关闭可能同时存在的左右响应式抽屉，并断言队列前景命中、纵向完整可见和document无横向溢出；未用早期被抽屉遮挡的截图代替最终证据。

### 最终交付边界

最终两份Electron专项均使用英文插值修正后的生产构建、临时profile及本地合成供应商，已正常退出。完整Vitest1880项通过属于这三处文案修正前的功能冻结；修正后重新类型检查、lint、构建及桌面验收，没有将旧套件误写为最后文案之后重跑。

收尾同一23份相关Markdown由现有Marked解析，23/23通过、0解析错误；识别293个链接，其中191个本地、102个远程，本地目标及27个锚点均有效。两份smoke脚本`node --check`和`git -c core.safecrlf=false diff --check`退出0。根package、desktop package及release常量均为1.3.3，政策修订号为`2026-11-04.3`；只读进程及端口检查确认两份smoke临时进程和9481/9482/9491/9492监听均无残留，没有结束正常用户实例。

本轮已同步README、双语使用手册/更新日志、第三方通知、DESIGN、调研及AGENT第58节。版本保持1.3.3，实验入口仍为根目录`run-experimental.cmd`；没有生成正式安装包或发布。PPTMaster完整Python流水线、复杂Office质量矩阵、官方ASD认证、前轮Word占用与3项moderate传递依赖仍属于已记录边界。

## 2026-11-18 frontend-design 安装与光轨布局优化

### 实际范围

将用户指定的`WorkAgentSkill/frontend-design`安装到`C:\Users\ASUS\.codex\skills\frontend-design`。源与目标均为2文件、19,564字节，完整路径集合和SHA一致，许可原文保留；安装前目标不存在。已完整阅读并应用该技能，结合现有Impeccable上下文与Taste应用方向，选择连续工作台布局，方向为`framed-sheet`的flush L-frame变体、seed62851604。没有修改Harness内置技能目录或扩大Code/Work/Chat权限。

本轮运行时代码仅涉及`App.tsx`、`orbit-workbench.css`及`agent-modes.css`的布局、尺寸、配色与动画。标题条56px、工具轨48px、外边距12px、间隔8px、面包屑44px、状态栏24px；任务区按可用高度缩放。输入框按pane宽度重排上下文与底栏，保持引用、队列和推理/发送可达。Chat光轨页使用264px侧栏和固定24px空态标题。流式回复不再以0.55透明度入场，首帧正文清晰。版本仍为1.3.3、schema9、政策修订号`2026-11-04.3`，无新增依赖。

### 最终源码检查

```powershell
pnpm typecheck
pnpm lint
pnpm build
node scripts/check-package.cjs --source
node --check scripts/orbit-workbench-smoke.mjs
node --check scripts/interface-style-smoke.mjs
git -c core.safecrlf=false diff --check
```

Node/Web TypeScript与Biome380文件通过。最终生产构建通过：main135、preload3、renderer2254模块，25份TencentDB固定源哈希一致；main1606.03kB、preload31.10kB、renderer JS2553.66kB/CSS360.93kB。源码预检13,865资源、生产依赖及1.3.3通过。类型检查覆盖最终TypeScript，后续生产修改仅为CSS固定字号；最终lint/build均在其后通过。

补充运行既有`composer-input.test.ts`、`agent-mode-ui.test.ts`与`capability-picker.test.ts`：3文件、10项通过（705ms），没有为纯样式新增镜像测试。最后8份相关Markdown可解析、110个本地文件链接目标存在，`git diff --check`退出0；只读进程检查未发现三份smoke或其临时profile残留进程。

### 最终隔离 Electron 验收

三个脚本按顺序单独运行，均使用各自临时profile、临时项目和本地合成Responses供应商，不读取正常用户资料、不调用付费模型。最终构建之后没有再修改运行时代码。

| 命令 | 结果 | 当前证据 |
| --- | --- | --- |
| `node scripts/interface-style-smoke.mjs` | 20/20组，2次本地请求，40截图，2次实际启动，0 renderer异常 | `.impeccable/review/v133-interface-style-1795013451429/interface-style-result.json` |
| `node scripts/orbit-workbench-smoke.mjs` | 17/17组，13次本地请求（其中2次worker），45截图，0 renderer异常/服务错误 | `.impeccable/review/v133-orbit-layout-1795013890831/result.json` |
| `node scripts/orbit-stability-smoke.mjs` | 11/11组，48次测量，13截图，0布局问题/异常/崩溃 | `.impeccable/review/orbit-stability/final/result.json` |

风格专项验证真实设置radio保存与重载、完整草稿空白/公式预览/附件字节恢复、保存失败后重试、正常退出再启动、任务运行期间拒绝重载、未保存消息/计划/文件编辑与延迟保存竞争保护。流式正文第一帧自身、内容和祖先累计透明度均为1；真实运行状态灯在隐藏Electron窗口时暂停，显示后恢复。应用关闭动效和系统减少动态效果均使实际动画停止。

工作台专项保留真实工具执行、两个文件变更、完整命令尾部、三步计划及一个实际完成的只读子任务。检查1440与2559下对话作者/时间、执行记录、保存的diff及任务进度同时可见；800/1040/1280/1920/2559窗口内控制和输入区有界。手动引用面板能搜索、选择、取消，忙碌时实际队列能加入和删除，1440及800下均前景命中并无内部横向溢出。布局切换保留同一个textarea与文件编辑器节点和未保存内容，长模型/供应商保持完整tooltip与辅助技术名称，空选择无多余括号。720x450为1440x900的200% CSS布局等效，不宣称完整Windows系统DPI认证。

补充实际主界面切换WorkAgent、创建独立ChatAgent会话，分别验证1440/800、Chat日夜以及真实QuickChat540x720/400x560。Chat工作目录确为null，恢复Code后原会话、模型、权限、消息与计划快照保持不变，模式检查没有额外模型请求。QuickChat使用实际第二BrowserWindow，不以修改主页面DOM模拟；没有重跑整套全局快捷键/置顶生命周期，相关功能结果仍属于前轮。

长历史使用373条合成消息、180次`view_image`工具记录、大字段参数/输出与完整错误，80次本地SSE更新和8次原生输入。最终空闲输入P95 **11.1ms**，流式输入P95 **12.4ms**，两组均0长任务；工具详情展开/收起、长错误、语言切换及Simple回归均通过。图像字段只是大历史负载，不代表真实视觉模型质量或图像解码验收。

### 视觉检查与静态设计检查

保留修改前基线目录`.impeccable/review/v133-orbit-layout-before-1795010079305/`，其中复制来的旧`orbit-rebuild-failure.png`时间为2026-11-09，不作为本轮基线或失败证据。最终实际查看夜间与日间1440工作台、800英文输入区与引用面板、720x450缩放等效、Work1440、Chat1440日间/800夜间、QuickChat400x560，以及设置页截图。没有用遮挡输入框的抽屉截图证明输入区可用。

Impeccable最终`detect --json`在`App.tsx`和`orbit-workbench.css`无结果，`agent-modes.css`返回12项建议，涉及既有共享小字号、10px圆角、模式语义色及旧fluid标题；Orbit会话时间已覆盖为12px、标题覆盖为24px。Taste完整三文件静态lint报告共享Chat旧渐变1项FAIL与30项shadow建议；该渐变在Orbit由更高优先级纯色规则覆盖，未为静态告警修改Simple既有设计，也不宣称完整三文件静态门禁全绿。普通网页检查器无法提供Electron preload/API，视觉与运行检查使用上述真实Electron CDP，不伪造浏览器检查器通过结果。

新主题辅助文本的实际token配对按WCAG相对亮度计算：夜间muted/surface **8.34:1**、faint/surface **6.80:1**；日间 **5.35:1 / 4.62:1**。这证明所列文本配对达到4.5:1，不替代整个应用的全状态无障碍认证。

### 本轮修正历史

- 初次新增引用/队列窄窗覆盖后，脚本关闭了响应式抽屉，却在恢复1920时继续断言右面板已展开；三个新增分组已通过，后续断言失败。新增真实控件`restoreWidePanels`后完整15组通过，后续再补三模式与小窗得到最终17组，不把中途15组当最终构建。
- 风格专项抓到流式正文首帧透明度0.55，已从keyframe移除透明度变化并重新构建，最终首帧透明度断言通过。之后旧脚本仍等待已取消的输入框循环光迹而超时，改为验证真实运行状态灯及隐藏暂停，没有放宽正文透明度要求。
- 布局审查补充常量、更新按钮和Chat样式后，Biome仅报告两个常量换行格式；按仓库格式调整后完整lint通过。生产源码在最终三份Electron前冻结。
- 22:17的长历史11组和目录`1795012087037`的15组属于收口前构建。最终长历史已在最后构建后完整重跑，当前result由该次覆盖，不借用旧截图证明本轮修改。

DESIGN、双语更新日志和使用手册、AGENT第59节同步最终有效颜色、尺寸、输入区层次和模式。资源预检不是ASAR/NSIS验收；本轮未重跑完整后端Vitest，前轮1880项作为历史功能基线保留。没有正式安装包、安装升级、云写入、正常用户DB/Key、付费模型、提交或推送；完整Office/第三方扩展、Windows系统DPI和辅助技术矩阵仍未验收。

## 2026-11-19 frontend-design 光轨任务区与办公起始布局

### 实际改动

沿用前轮连续工作平面，新增右栏任务高度调节和单行收起；审查文件以文件名/父目录分层，预览头保留文件名，长目录优先显示末端；光轨Work空会话增加Word、Excel、PPT起始草稿。会话行与右栏操作密度同步调整，空态和输入区对齐。无新增依赖，保持1.3.3、schema9、政策修订号`2026-11-04.3`、用户数据位置及水青原子图标。

`ProjectLayout.taskPanelHeight`是可选有限值，归一化到160–640；实际高度还受窗口可用空间限制。窄窗160px仅是未自定义时的默认值；风格/工作区偏好隔离，旧记录形状兼容。拖动在pointer up时保存；Esc、取消或丢失capture回滚。上/下方向键每次16px，Home/End边界，Enter及双击删除自定义高度恢复响应式默认；横向separator提供方向和操作说明。8px命中区、32px握柄与焦点轮廓保留，最后一次目视收口去掉整条强调色hover。

折叠不卸载组件。未保存计划的切会话/Chat/新建及当前会话归档受保护，自动展开计划页提示先保存或取消；Code/Work同会话切换可继续，计划revision校验不变。通知恢复标记仅在会话选择成功后记录，结束计划编辑后重新读取待恢复通知。该处理不持久化未保存计划，不代表任意renderer退出都能恢复计划表单。

### 静态与定向验证

```powershell
pnpm typecheck
pnpm lint
pnpm --filter @mingshen/desktop exec vitest run src/shared/ui-preferences.test.ts src/renderer/src/lib/agent-mode-ui.test.ts src/renderer/src/lib/composer-input.test.ts src/renderer/src/lib/capability-picker.test.ts src/renderer/src/lib/use-composer-draft.test.ts
pnpm build
node scripts/check-package.cjs --source
node --check scripts/orbit-workbench-smoke.mjs
git -c core.safecrlf=false diff --check
```

- Node/Web类型检查通过；最后TypeScript修改后的Biome380文件通过。定向Vitest **5文件37项通过（994ms）**，包含布局旧记录、非法值、上下界、风格隔离和草稿生命周期。
- 最终生产构建通过：25份TencentDB源哈希、main135/preload3/renderer2254模块；main1606.32kB、preload31.10kB、renderer JS2568.04kB、CSS364.11kB。最后修改仅为握柄hover CSS，随后已重建并完整重跑工作台。
- 源码资源预检 **13,865项资源**、生产依赖及1.3.3通过；不是ASAR、NSIS、安装升级验收。
- Impeccable静态检测在本轮6份TSX/CSS文件无建议，但只运行regex规则，不能替代真实页面的字号、对比度、布局或无障碍检查。既有共享样式建议及前轮边界不被抹去。

### 隔离 Electron 验收

三个脚本串行运行，各使用临时profile、项目和本地合成供应商，不读取正常用户资料或调用付费模型。

| 脚本 | 结果 | 本轮证据 |
| --- | --- | --- |
| `interface-style-smoke.mjs` | 20/20组，2次本地请求，40截图，2次实际启动，0renderer异常 | `.impeccable/review/v133-interface-style-1795049887096/interface-style-result.json` |
| `orbit-workbench-smoke.mjs` | 25/25组，13次本地请求（含2次worker），52截图，0renderer异常/服务错误 | `.impeccable/review/v133-orbit-layout-1795051139732/result.json` |
| `orbit-stability-smoke.mjs` | 11/11组，48次测量，13截图，0布局问题/异常/崩溃 | `.impeccable/review/orbit-stability/final/result.json` |

风格与长历史完成后，最后只调整了任务分隔条的hover背景并重新构建；最终25组工作台在该CSS修改后完整重跑。20组与11组不宣称在最后hover修改后重跑，长历史`final/result.json`已由本轮结果覆盖，第59节的11.1/12.4ms仍是历史数字。

工作台新增验证包括：

- 真实CDP鼠标拖动使任务高度由252px到332px；键盘16px与Home/End、Esc回滚、延迟后偏好不变及重载恢复均通过。Enter/双击后偏好字段确实缺失；收起状态及自定义高度重载保留，Agent入口展开。握柄与背景的实际计算颜色不同，没有整条强调色填充。
- 收起前后保留同一个任务组件、计划输入框和文件编辑器；取消计划编辑后已保存计划与消息快照不变。布局模式切换保留composer/editor节点，文件/终端标签切换只要求内容保留，不误称编辑器节点不会重建。
- 计划正文和依赖编号处于未保存状态时，真实点击Chat、其他会话及当前会话菜单“归档”均被阻止，计划自动展开回到可见提示；正文/依赖输入节点和值不变，后端`archived`仍为false。取消后Chat可进入，原Code数据保留。
- 中英文真实Accessibility树均含完整相对路径和精确新增/删除数，预览文件名及目录分别验证；不把覆盖子节点统计的旧`aria-label`当通过。
- 中英文Work空态三个按钮以实际鼠标点击连续追加完整草稿、聚焦输入框，当前草稿前缀不丢；消息仍为0且模型请求不增加，恢复Code后没有Work起始入口。
- 800×600英文任务抽屉的标题、Agent与收起按钮不重叠，收起标签/ARIA正确；1440/2559工作台、800/1040/1280/1920尺寸、720×450 CSS缩放等效、三模式和真实QuickChat仍通过。引用/队列保持前景命中，模型/供应商完整tooltip及辅助技术名称保留。

长历史373条合成消息、180次工具记录和80次本地SSE更新通过。输入P95为空闲 **7.3ms**、流式 **9.9ms**，均0长任务；8次原生输入、完整错误/参数/输出和双语/简约回归通过。大图像字段仅为负载，不代表图片解码或视觉模型质量。

### 复核与修正历史

- 首次exact optional props类型检查失败，已改为条件props及允许明确undefined的重置字段，重新类型检查通过。
- `1795049722955`通过5组后，新折叠断言使用了切换Terminal之前的旧编辑器节点。Files重建编辑器但内容仍完整，夹具改为回到Files后重新采集折叠基线节点；原布局切换同节点断言保留，没有修改产品去满足错误断言。
- `1795050210722`通过9组后真实鼠标拖动未生效；`1795050478950`增加pointer事件诊断，实际只有pointerdown，无后续move/up。CDP按住左键移动时改用`button:left`并留出短暂capture处理时间，后续完整25组通过；没有用DOM伪造pointermove来替代真实输入。
- `1795050646076`已25组通过，目视发现继承的hover把整条8px分隔区染为品牌色；新增局部背景覆盖，保留握柄高亮及焦点轮廓。最终`1795051139732`再次25组通过，实际查看新截图确认。
- 独立审查补齐审查行增删统计、长路径文件名、Enter重置，以及未保存计划导航、通知恢复标记与归档入口；无安全策略或模式权限放宽。

实际查看本轮最终任务高度调整、日间工作台、Work中英文空态、未保存计划提示、英文800抽屉、收起任务和独立Chat截图；没有发现阻断性控件遮挡或页面横向溢出。正常打开响应式抽屉会遮住背景对话，不能用该状态证明背景composer可点击。未认证完整Windows系统DPI、所有路径脚本/文字方向或辅助技术矩阵。

DESIGN、双语手册/日志及AGENT第60节同步。未重跑完整后端Vitest，1880项仅作为历史功能基线；完整Office/第三方插件和既有依赖审计边界保留。本轮没有正式安装包、安装/升级、正常用户DB/Key操作、云写入、付费模型、提交或推送，实验入口仍为`run-experimental.cmd`。

收尾用项目现有Marked解析AGENT、DESIGN、README、双语手册/更新日志及本记录，共8份全部通过；151个本地文件链接目标存在、0缺失。差异空白检查退出0；只读进程查询未发现三份smoke或临时profile残留，没有关闭用户实例。

## 2026-11-19 文档同步与打包资源复核

用户要求同步相关文档、检查打包资源并提供自行打包命令。本轮保留1.3.3、schema9、政策修订号`2026-11-04.3`、原子图标及全部已有工作区修改，没有修改运行时代码。

README补齐光轨任务区、Work起始草稿、计划导航及归档保护。双语手册/更新日志补齐未保存计划时归档当前会话或祖先会话会被阻止的说明；双语手册更正窄窗抽屉打开时会覆盖背景对话、关闭后继续输入的行为。AGENT当前结构表校正为schema9，打包指南移除旧资源/技能数量和Documents路径，说明来源目录保留、`--dir`可选、正式入口自动重建和缓存文件分别复制的边界。

### 本轮实际检查

执行环境为当前`C:\Users\ASUS\Desktop\MingshenHarness`，Node为`D:\NodeJs\node.exe` v24.19.0；`.cmd`实际找到的pnpm版本为11.25.0。没有设置依赖校验绕过，也没有重新安装依赖。

```powershell
.\package-win.cmd --check
node --test --test-reporter=spec --test-concurrency=1 scripts/package-paths.test.cjs scripts/package-runtime-copy.test.cjs scripts/package-native-copy.test.cjs scripts/package-document-runtime.test.cjs scripts/tencent-memory-package.test.cjs scripts/provision-electron-runtime.test.cjs scripts/windows-icon.test.cjs scripts/generate-icon.test.cjs scripts/prepare-experimental-runtime.test.cjs scripts/work-skill-inventory.test.cjs
```

- 用户入口预检退出0：**13,865项资源、生产依赖和1.3.3版本一致性通过**。Electron运行时、原生沙箱哈希、TencentDB来源/运行资源、离线OCR、Windows解析器、文档作者依赖、图标及内嵌文档均进入实际预检。
- **10个Node测试文件、80/80项通过，0失败/取消/跳过（41.60秒）**。覆盖当前目录迁移后的hoisted/app-local Electron解析、缺失运行时拒绝和准备、Windows复制与构建路径保护、图标恢复和原图保护、真实合成ASAR的DOCX/PPTX/XLSX依赖闭包及缺包拒绝、TencentDB许可/哈希/ESM闭包、Work来源的同名多版本和10个PDF路径/5种正文校验。测试用ASAR和临时EXE属于合成夹具，不是产品正式解包程序或安装器。
- 以YAML解析器核对`electron-builder.yml`的**10处extraResources来源均存在**，`prompts/**`、`sdk/**`、`documents/*.cjs`/`*.ps1`和`docs/*.md`映射与实际资源一致；ASAR及afterPack保留，Windows仍为x64、当前用户、未签名NSIS、可选择安装目录及既定原子图标。
- Work来源124个物理入口/104种正文、PPTMaster的13,089文件、ASD-STE100的9文件及其来源/副本树哈希由本次预检核对；本地插件SDK、Creator技能和Office COM脚本在必需资源清单及对应extraResources映射中，未见本轮新增资源遗漏。

### 自行打包与边界

在当前仓库根目录执行`.\package-win.cmd`即可。入口自动准备Electron、图标和固定沙箱，执行生产构建、源码预检、electron-builder及afterPack，无需先单独运行`--dir`。正常项目输出目录为`apps\desktop\release-artifacts\`，生成`MingshenHarness-1.3.3-x64.exe`、同名`.zip`、`.zip.sha256`和`.zip.json`；ZIP只封装版本匹配的安装EXE，其SHA-256和字节数按本次产物自动计算。

构建缓存位于`%LOCALAPPDATA%\MingshenHarness\BuildCache\windows-1.3.3-*\output\`。项目复制失败会分别提示`Cached installer:`或`Update artifact retained in build cache:`，脚本可能仍退出0，应按控制台路径核对对应文件。源码预检依赖根`WorkAgentSkill/`、`ppt-master/`和`asd-ste100-skill-master/`来源目录，打包前保留；安装后的应用使用随包副本，不读取开发仓库。

本轮没有重跑应用完整Vitest、GUI或生产构建，没有生成正式解包/NSIS/ZIP、安装/升级、执行云SQL、付费模型请求、正常用户DB/Key操作、提交或推送。第60节和此前的应用验证仍为对应轮次历史证据；本次只证明源码资源预检及打包相关回归通过，正式afterPack将在维护者打包时运行。历史1.3.2发布SQL、SHA和大小保持原记录，不复用于新1.3.3包。

文档收尾使用项目现有Marked解析AGENT、DESIGN、README、双语手册/更新日志及本记录，**8/8份通过，152个本地文件链接目标存在、0缺失**；`git -c core.safecrlf=false diff --check`退出0。文档更新后的同一`.\package-win.cmd --check`再次退出0，资源数量仍为13,865，生产依赖及1.3.3版本通过。

## 2026-11-19 十条FIFO自动发送队列

本轮将第58节所述8条、显式继续的历史队列升级为用户要求的最多10条自动FIFO。主Code/Work/Chat在运行中加入后续消息，正常成功且后台资源清理完成后，主进程自动派发首项；当前运行不计入待发上限。删除逐项发送及重排控件，兼容接口也不能越过首项。编辑正文或选择替换附件先持有主进程hold，保存/显式取消后恢复派发；离开编辑会话或renderer退出则保留并暂停，避免发送未保存前的旧内容。Stop、失败、发送失败及应用重启保留并暂停队列，通过统一恢复按钮继续。

版本保持1.3.3、schema9、队列存储版本2、政策修订号`2026-11-04.3`。现有附件字节验证、配置快照、持久化派发claim、工具权限和QuickChat/SubAgent边界保留。生命周期使用清理后的明确outcome及准备锁结算，不依赖提前发出的`run_completed`；极短任务、重复通知与后台会话由服务端协调。

### 自动检查

- Node/Web TypeScript与Biome **381文件**通过。
- 捆绑Node直接启动完整串行Vitest，退出0：**145文件通过/3跳过，1904项通过/14跳过，175.67秒**。运行命令为在`apps/desktop`使用捆绑Node执行`../../node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism`。14项为既有环境/可选集成跳过，不算实际通过。
- 最终专项重跑queue service、run lifecycle和QuickChat三个文件，**41/41项通过，3.59秒**，与完整结果重叠不相加。涵盖10条及第11条拒绝、每轮成功后派发一条、FIFO、防重复、接受前已经完成的极短任务、Stop/失败、编辑保存与取消/owner丢失、配置/归档/退出阻塞、发送失败与claim清理失败、SQLite重启、compaction清理结果和快捷窗口八项IPC拒绝。
- `pnpm build`通过，main **135**、preload **3**、renderer **2254**模块，25份TencentDB固定来源哈希一致。最终界面props以Resume命名，preload保留兼容continue接口；构建源码不改变协议或执行权限。
- 用户入口`.\package-win.cmd --check`退出0：**13,865项资源、生产依赖及1.3.3版本通过**，本轮没有生成NSIS或ZIP。

### 真实桌面验证

`node scripts/queued-prompt-smoke.mjs`最终退出0，证据为`.impeccable/review/v133-queued-prompts-1795056260978/result.json`：**13/13组、30次本地Responses请求、8截图、0renderer异常**。独立临时profile与项目、本地合成供应商，实际退出并重启Electron后验证持久队列，不使用普通浏览器无preload页面替代桌面。

关键断言包括：

- 运行中加入多项、正文保存、附件替换、删除；编辑hold期间前一任务成功完成也不能发送旧内容，保存后发送实际新正文及附件。
- 连续两项自动FIFO完成，并在选中其他会话期间执行；切回后用户历史和实际模型请求顺序一致、队列为空。显式取消编辑不保存临时文字，继续使用原已保存内容。
- 完整10条`QUEUE_DRAIN_1`至`QUEUE_DRAIN_10`通过立即成功响应自动排空，历史及实际请求逐项顺序一致；界面禁用第11条且后端同样拒绝。
- 故意HTTP500、maxRetries=0：失败项已经启动并进入历史，剩余队首暂停、展示真实错误、不提前发送下一项；统一恢复后才继续。
- Stop保留3条，正常退出/重启仍保持原顺序并标记restarted；恢复只启动第一条，后两条等待其运行结果。
- 主Chat自动发送排队项，同时实际`read_file`恶意工具请求仍被拒绝；真实provider生成的SubAgent无法入队；QuickChat的list/add/update/reorder/remove/continue/begin-edit/end-edit八项IPC均被拒绝。
- 光轨日夜及800px英文队列前景命中、纵向完整且无横向溢出，header显示`N/10`，恢复按钮仅在暂停时出现。

实际查看最终光轨日间、800px英文夜间及编辑hold截图。队列沿用紧凑工作台布局，无逐项手动发送或重排入口；窄窗状态文案允许缩略并保留提示。未认证所有Windows系统DPI/辅助技术组合，真实模型的内容质量不由合成供应商证明。

### 夹具修正与边界

早期桌面结果保留为failure记录：纯文本无末尾换行而旧断言强制换行（`1795054845706`、`1795055072766`）；背景会话/旧会话被侧栏默认最近3条折叠导致选择超时（`1795055230127`、`1795055365958`、`1795055721964`）；把最后一个host上下文消息误当用户正文（`1795055505381`、`1795055545383`）；observer夹具重命名残留（`1795055643184`）。已改为严格比较目标正文首行、排除明确host上下文记录、选择前展开会话组及统一observer引用，最终完整13组重跑通过。没有修改产品权限、跳过FIFO断言或隐藏失败来通过。相邻`orbit-workbench-smoke.mjs`计数断言同步为`1/10`并通过语法检查，未将该脚本前轮25组当作本轮重新运行。

README、DESIGN、双语手册/更新日志、T3研究和AGENT第62节同步。完整suite早于最后的纯renderer回调名称整理，最终类型/代码检查、专项41项和上述完整Electron在整理后通过；后端生命周期实现没有在完整测试后改动。没有正式包、安装/升级、付费模型请求、正常用户DB/Key操作、云写入、提交或推送。实验构建入口仍为`run-experimental.cmd`。

### 自动队列最终收口

最终完整串行Vitest由捆绑Node在`apps/desktop`执行，退出0：**145文件通过/3跳过，1918项通过/14跳过，227.21秒**。本节上方1904项是同一轮收口前历史结果，不能与最终1918项相加。最终Node/Web TypeScript检查和Biome **381文件**通过；`pnpm build`退出0，包含main **135**、preload **3**、renderer **2254**模块，25份TencentDB固定源哈希一致。最终产物main **1620.64kB**、preload **31.47kB**、renderer JS **2580.45kB**、CSS **365.61kB**，入口为`index-DcGB_3ap.js`和`index-C2x_YhHG.css`。`.\package-win.cmd --check`退出0：**13,865项资源、生产依赖及1.3.3版本通过**。

最终`node scripts/queued-prompt-smoke.mjs`退出0，证据：

```text
.impeccable/review/v133-queued-prompts-1795060125059/result.json
```

结果为**16/16组、38次本地Responses请求、9截图、0renderer错误，并执行实际重启**。本轮新增收口证据包括：

- WorkAgent自动队列连续两项按FIFO完成。
- 超过25MiB的附件替换失败后暂停并保留原附件，自动请求数为0；手动恢复后才发送原附件。
- 队列直接`@General`与真实child关联，child完成前不发送parent后续；child完成后parent历史只含initial/followup，child保留独立任务正文。
- 普通直接`@`保持原行为，18项lifecycle测试覆盖不伪造parent run事件，也不向实际SubAgent开放queue。

早期新smoke `1795059737286`在`backgroundSession`选择阶段超时，当时已有3组通过且0renderer错误。原因是helper只展开`showAll`，没有等待初始group展开；现改为轮询先展开group再执行`showAll`，并把目标滚动到可见。mention夹具原有要求复制parent history的`parentHistory`误断言已移除，因为mention只保存child，不复制父history。最终16组在上述夹具修正后完整通过。先前v1审查finding因缺少确切历史shape或写入证据已撤回；没有修改队列storage或schema。

收尾实际查看最终光轨日间、800px英文夜间和附件替换失败截图，队列、编辑/删除及异常恢复入口可见，无横向溢出。用现有Marked解析9份相关Markdown，154个本地链接目标存在、0缺失；smoke临时进程已退出，没有关闭用户已有实验实例。最后运行时代码变更后已完成上述完整测试、构建和桌面验证，之后仅修正smoke夹具及文档。没有生成安装包，没有安装/升级、云写入、付费模型、正常用户profile/Key、Git提交或推送。

## 2026-11-19 README 与 Release 文案同步

用户准备自行提交 1.3.3，要求更新 README，并提供 GitHub Release 的标题和简介。本轮仅整理公开说明及发布草稿，保留工作区已有修改和应用配置。

- README 精简版本亮点，补齐 Code/Work 工程与办公能力、Skills/本地插件、自动 FIFO 队列、快捷 Chat 和光轨布局说明；将 Gemini 原生协议、Gemini/DeepSeek 缓存及 Word 表格公式明确归入 1.3.2 已有能力。快捷键说明纠正为 `Ctrl+M` 二键、`Ctrl+Alt+L` 三键。
- 新增 `docs/RELEASE_1.3.3.md`，提供中英文 Title、简介及正文，建议使用 `V1.3.3` 标签；使用固定标签的 GitHub 绝对文档链接，便于粘贴到 Release。标签需要由维护者指向最终提交后发布，本轮没有创建标签或请求远端链接。
- Work 技能区分 124 个物理来源、104 种源正文 SHA 和 93 个名称；Office 重算/渲染继续描述为有条件的可选能力，没有把来源内置或结构检查写成第三方完整流水线、正式安装/升级或视觉质量已认证。

实际使用项目现有 Marked 解析两份公开文档，**2/2 通过**；**49 个本地链接/图片、6 个页内导航锚点及 6 个固定标签链接对应的本地源码目标均存在，0 缺失**。同时核对根包、桌面包与 `release.ts` 为 1.3.3，README 中列出的 pnpm 脚本及启动/准备文件存在。`git -c core.safecrlf=false diff --check` 通过；远端标签可用性不属于本地链接检查。

交接记录同步至 AGENT 第63节。本轮未修改运行时代码、版本、许可、schema 或用户数据，未重新运行应用测试、GUI、生产构建及打包，未替用户执行提交、推送、Release 发布或云 SQL。前轮最终1918项应用测试、Electron与打包资源结果仍为其各自实际运行的历史证据，不算本轮重跑。

## 2026-11-19 实际 1.3.3 ZIP 与发布 SQL

维护者提供GitHub Releases ZIP下载直链，要求读取本地产物并生成发布SQL。本轮从 `apps/desktop/release-artifacts/` 只读检查维护者已生成的1.3.3文件，未重新打包或运行安装器。

| 核对项 | 实际结果 |
| --- | --- |
| ZIP | `MingshenHarness-1.3.3-x64.zip` |
| ZIP修改时间 | 2026-11-19 12:13:13（Asia/Shanghai） |
| ZIP字节数 | 318504814（303.75 MiB） |
| ZIP SHA-256 | `39039e54ec234f0c23ce629a6cb81aac5f26f979a264ff6f60f390f245d12d90` |
| JSON与SHA旁文件 | 版本、格式、文件名、完整哈希和字节数全部一致 |
| ZIP目录 | 恰好一个根目录文件 `MingshenHarness-1.3.3-x64.exe` |
| 内嵌安装器字节数 | 319403978，与旁置EXE一致 |
| 内嵌安装器SHA-256 | `2d896db38745bfe292528e514441e204cc462d3f9291b49449d01a3b6f24c669`，与旁置EXE一致 |
| 安装器ProductVersion | Windows版本资源只读返回1.3.3 |

使用 `Get-FileHash` 独立重算ZIP哈希，再以只允许共享读取的 `FileStream` 在同一流上重算SHA、定位ZIP目录和流式计算内嵌EXE哈希；不解压、不执行包内程序。JSON及SHA旁文件只是交叉核对依据，没有只采信生成元数据。

新增 [publish-release-1.3.3.sql](../supabase/publish-release-1.3.3.sql)，包含维护者提供的 `https://github.com/SkyH1aa/MingshenHarness/releases/download/V1.3.3/MingshenHarness-1.3.3-x64.zip`，沿用 `public.mingshen_app_releases`、ZIP字段、`now()`、启用状态及同版本幂等更新。公告涵盖三模式、办公/工程、技能、插件、自动队列、后台SubAgent、光轨和快捷窗口，**721字符，小于1000字符数据库约束**。

Node静态检查退出0：版本、HTTPS URL及2048字符上限、ZIP格式、64位SHA、实际字节数及2GiB范围、公告长度、八个插入字段全部匹配；upsert和returning尾部与1.3.2文件完全一致，文件无占位符且只有一条目标表插入，不含DDL、删除或授权。差异空白检查通过。Supabase README、部署说明及AGENT第64节同步，旧发布SQL和历史元数据未修改。

本轮只生成本地SQL与说明，未执行云端PostgreSQL、修改线上发布记录、重新下载远端ZIP或确认其内容，也未重新打包、安装/升级、访问正常用户DB/Key、运行应用回归、提交或推送。维护者在部署0003后手动执行新SQL，再查询 `select * from public.mingshen_get_latest_release_v2();` 核对有效版本、URL、哈希及大小。已有更高版本测试记录仍按原规则优先，本轮不自动停用。
