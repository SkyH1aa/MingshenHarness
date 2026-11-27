# Mingshen Harness 办公交付验证

适用版本：1.3.7 · 主 CodeAgent / WorkAgent · Windows 10/11 x64

本文说明 DOCX、XLSX、PPTX 和 PDF 的交付回执、重算、渲染、逐页视觉检查、预算和降级状态。文件生成成功与交付验证通过是两个独立结论。

> 当前源码会在主 CodeAgent/WorkAgent 使用宿主执行、完全访问且存在工作区时，对工具批次后产生或修改的 DOCX、XLSX、PPTX、PDF 自动准备回执并运行交付检查。可修复问题回到模型，按每个文件最多 3 轮修复；达到预算后当前运行对该文件的后续写入被阻断。任务工作台可列出回执并继续未完成的视觉批次。隔离 LibreOffice 渲染已有本机现场证据，但真实 Microsoft Office COM、真实视觉模型、完整 Office/LibreOffice/均未安装矩阵和正式打包环境仍须标为未验证；任何未执行项不能因单项渲染成功而视为通过。

## 支持范围

| 格式 | 包与结构 | 公式与重算 | 渲染 | 视觉复核 |
| --- | --- | --- | --- | --- |
| DOCX | 是 | 公式内容检查，非 Excel 重算 | Office 或 LibreOffice 的受控 PDF 副本 | 支持 |
| XLSX | 是 | 公式扫描、错误检测、可选 Microsoft Office 重算 | Office 或 LibreOffice 的受控 PDF 副本 | 支持 |
| PPTX | 是 | 不适用 | Office 或 LibreOffice 的受控 PDF 副本 | 支持 |
| PDF | 是 | 不适用 | 源 PDF | 支持 |

回执只适用于实际生成或受控修改后的文件。上传附件读取、文本提取和“文件已写入”提示不能触发已验证状态。

## 检查链路

1. **包安全与结构**：检查文件是否为普通文件、大小、格式签名、ZIP 路径、条目数、声明解压量、XML 主动声明和受支持结构。
2. **内容检查**：检查文档结构、可编辑对象、公式错误、表格、图片关系和必要的归档完整性。
3. **公式检查**：XLSX 统计公式总数、错误值、缓存状态和展示样本。达到扫描预算时必须标为部分覆盖。
4. **重算**：仅在已安装 Microsoft Office、执行环境符合规则且使用临时副本时尝试。未安装或权限不允许时标记不可用。
5. **渲染**：优先使用 Microsoft Office PDF 导出；不可用时可按配置探测 LibreOffice，并使用独立临时目录和临时用户配置。
6. **逐页视觉复核**：将渲染页分批交给当前支持图像输入的会话模型或设置中指定的视觉模型。
7. **最终状态**：调用办公交付服务并完成本轮要求的包、结构、渲染和视觉覆盖后，才可得到该次检查的 `verified`。缺失环境、无视觉模型、页码遗漏或预算截断必须保留在 `unverified` 或 `issues`。

当前集成边界：

- 自动路径只适用于主 CodeAgent/WorkAgent、`host` 执行、`full_access` 且有工作区的会话；ChatAgent、子 Agent 和沙箱执行不会获得宿主文件读取或办公验收权限。
- ChatService 在工具批次后识别发生变化的办公文件，调用 `OfficeDeliveryService.prepare()` 与 `check()`，把可修复问题作为下一轮诊断交给当前模型。修复后的新文件 SHA-256 会使旧回执失效，并重新进入检查。
- 每个文件在当前运行内最多自动修复 3 轮，实际值还受应用设置和机器策略收紧。预算耗尽后，后续对该文件的写入及无法明确目标的宿主变更会被阻断，需要查看回执、核实文件并以新运行继续。
- 缺少 Office/LibreOffice、视觉模型、渲染器或页面预算时停止反复改文件，保留 `partial` / `unverified` 和具体未验证项；包损坏、主动内容或其他安全问题阻断交付。
- 自动接线不等于完成真实环境验收。仍需覆盖 Office、LibreOffice、两者均未安装、公式错误、文字溢出、裁切、缺页、文件外部变更和三轮上限的现场测试。

## 硬上限与完整性

| 项目 | 上限或默认值 | 语义 |
| --- | --- | --- |
| 交付输入 / 源文件 | 每个文件 25 MiB | 宿主按普通文件、句柄身份和路径稳定性校验 |
| Office 渲染输出 | 256 MiB | 超过即停止并标为未验证，不把大输出当成功 |
| XLSX 公式交付扫描 | 500,000 个非空单元格 | 超过后只能报告截断覆盖，不能宣称完整公式验证 |
| 公式样例 | 最多 50 条，每条公式/结果最多 1,000 字符 | 仅用于展示，不代替全量统计 |
| 视觉批次硬上限 | 20 页 / 20 MiB | 设置不能提高到硬上限以上 |
| 视觉批次默认值 | 12 页 / 12 MiB | 可在应用策略内收紧 |
| 每文件每轮视觉预算 | 默认并最多 200 页 / 200 MiB | 超出部分明确标为未验证 |
| 视觉证据缓存 | 24 小时 / 512 MiB | 清理缓存不删除会话回执或原始消息 |

Office 渲染输出上限与后续 PDF 解析器上限是两层限制。即使渲染文件不超过 256 MiB，解析器仍可能在 25 MiB 处拒绝输入；此时渲染可以是成功的，但视觉检查必须保持 `unverified`，不能四舍五入为交付通过。

### 结构、内容与公式结果

- `structureCheck` 分别表达包/结构与内容检查。只验证结构，或只抽样检查内容时，状态必须是 `partial`；不能写成 `content: verified`。
- `formulaCoverage` 独立报告 `complete`、`inspectedCells`、`formulas`、`uncachedFormulas`、`errors`、`sampleLimit` 和 `samples`；非 XLSX 回执为 `null`。公式结果中的 `#DIV/0!`、`#SPILL!` 等错误是真实问题，不因存在缓存值而消失。
- XLSX 公式阶段采用最强严重性合并：实际重算、错误对象、未缓存公式和截断扫描分别保留。扫描达到 500,000 非空单元格上限或只检查样本时，不能返回“公式完整验证”。
- `verified` 只用于本轮要求的结构、内容、公式、重算、渲染和视觉阶段全部达到要求的情况；任何抽样、截断、缺页、解析器拒绝或未验证项都必须以 `partial`、`unverified` 或 `blocked` 显式保留。

### 完整性与中途变化

- 交付输入使用句柄式有界读取器：拒绝非普通文件、设备/FIFO/目录和路径替换，并在 `lstat/open/fstat` 前后核对设备、inode、大小、mtime 和 ctime。读取上限为初始大小加 1 字节，用于发现期间增长；它不是持续监视外部 writer 的磁盘监控器。
- 交付服务在回执持久化前后都重查最终文件和源文件 SHA-256。缓存 PDF 在解析前重新核对大小与 SHA-256；缓存命中不能跳过完整性检查。
- 检查期间文件或源文件变化，回执必须转为 `stale` 并返回 `OFFICE_DELIVERY_CHANGED_DURING_CHECK`；中间窗口内也不能短暂返回 `verified`。

## Office 与 LibreOffice

### Microsoft Office

- 不随应用安装或打包。
- 自动回执路径只在主 CodeAgent/WorkAgent、宿主执行、完全访问、工作区和权限/管理策略允许时尝试；直接 `office_document` 创建、编辑和基础验证仍只对 WorkAgent 开放。
- 使用临时副本，不接管用户正打开的文档，不自动宏运行。
- 目标 Office 应用已在使用或 COM 不可用时，结构检查仍可完成，但重算或渲染标为未验证。
- 超时和取消应清理受管进程身份；清理未确认时不得假报已停止。

### LibreOffice

- 启动时按常见安装路径或宿主配置探测，不自动安装。
- 使用独立临时工作目录、输出目录和用户配置目录。
- Windows 优先使用同目录的 `soffice.com` 控制台入口；只管理本次任务拥有的进程树或 POSIX 进程组，不广域终止用户正在使用的 Office 进程。
- 默认渲染超时为 90 秒；每次调用只处理受控副本。
- 输出必须具有有效 PDF 签名，找不到输出或进程失败时明确降级。
- 取消会传播 `AbortSignal.reason`，被取消的检查不写回执或修订。精确拥有的进程树使用 `taskkill`/POSIX 进程组终止并等待 `close`；清理无法确认时返回 `unavailable` 和 `LIBREOFFICE_CLEANUP_UNCONFIRMED`，不假报停止成功。
- 当前没有 Windows Job Object 隔离，也不保证系统强制结束、父进程崩溃或外部启动器留下孤立进程时一定能清理；这一边界必须保留。
- LibreOffice 的字体替换、分页和 Office 兼容性可能与 Microsoft Office 不同。

### 源 PDF

PDF 直接作为渲染证据，但仍须完成结构、内容和逐页视觉检查。有效 PDF 签名或文字可提取不代表版式正确。

## 回执字段

宿主生成的回执以最终文件 SHA-256 为核心，包含：

- `id`、`sessionId`、`runId`
- 文件名、格式、字节数和 `sha256`
- 可选的源文件名称、大小和 SHA-256
- 交付总状态
- 包、结构、内容、公式、重算、渲染和视觉各阶段状态
- `formulaCoverage`：`complete`、`inspectedCells`、`formulas`、`uncachedFormulas`、`errors`、`sampleLimit` 和最多 50 条有界 `samples`
- 使用的引擎：`microsoft_office`、`libreoffice`、`source_pdf` 或 `none`
- 结构摘要、问题、未验证项和修复建议
- 视觉总页数、已检查页、页码、批次数和视觉模型 ID
- 渲染 PDF 证据哈希、大小、临时缓存到期时间
- 创建、更新和检查时间及修订号

示例：

```json
{
  "fileName": "quarterly-review.pptx",
  "format": "PPTX",
  "status": "partial",
  "stages": {
    "package": "verified",
    "structure": "verified",
    "content": "verified",
    "formula": "not_requested",
    "recalculation": "not_requested",
    "render": "verified",
    "visual": "partial"
  },
  "formulaCoverage": null,
  "engine": "microsoft_office",
  "unverified": ["Visual review covered 18 of 24 pages."],
  "visual": {
    "totalPages": 24,
    "inspectedPages": 18,
    "complete": false
  }
}
```

字段值以实现返回为准；示例不表示真实文件已经验证。

## 状态语义

### 交付总状态

| 状态 | 含义 |
| --- | --- |
| `verified` | 本轮要求的包、结构、渲染和视觉检查均完成 |
| `partial` | 已产生有效证据，但覆盖不完整或视觉发现待修复问题 |
| `unverified` | 尚无可支持结论，或必要引擎/模型不可用 |
| `blocked` | 包损坏、安全问题或必须项失败，不能按合格交付 |
| `stale` | 文件或源文件哈希已变化，原回执失效 |

### 阶段状态

- `verified`
- `partial`
- `unavailable`
- `failed`
- `not_requested`
- `blocked`

`not_requested` 不是通过。PDF 不需要 Excel 重算，因此重算为 `not_requested`；PPTX 同样不适用。若目标环境或管理策略要求某个阶段，缺少该阶段会使交付不满足要求。

## 视觉模型与隐私

视觉复核会把渲染后的页面图片发送给所选视觉模型。调用前应确认：

- 文档内容允许发送给该供应商。
- 当前会话模型或指定模型确实支持图片输入和文本输出。
- 相关请求可能产生额外 API 费用。
- 模型判断可能遗漏裁切、重叠、字体替换、语义错误或品牌规范问题。

可关闭视觉复核，或指定一个独立的视觉模型。没有可用视觉模型时，宿主仍可完成结构、重算和渲染，但视觉项保持未验证，不能显示为完整视觉通过。

## 默认预算

| 预算 | 默认值 | 硬上限或处理 |
| --- | ---: | --- |
| 单批页数 | 12 页 | 20 页 |
| 单批图片 | 12 MiB | 20 MiB |
| 每文件每轮页数 | 200 页 | 200 页 |
| 每文件每轮图片 | 200 MiB | 200 MiB |
| 临时 PDF 证据缓存 | 24 小时 | 512 MiB |
| 自动修复轮数设置 | 3 轮 | 最多 3 轮 |

超出页数或图片预算时：

- 已完成页面保留真实证据。
- 未渲染或未检查页面写入 `issues` 与 `unverified`。
- 总状态保持 `partial` 或 `unverified`，不能四舍五入成 `verified`。
- 用户可以手动继续后续批次，但每次继续仍受硬预算和管理策略限制。

## 自动修复设置与当前边界

设置中可以填写 0 到 3 的自动修复轮数，管理策略也只能收紧这个值。主 CodeAgent/WorkAgent 的宿主办公路径会按这个预算把可修复问题交回模型：

- 每轮只处理回执指出的具体、可修复问题，修复后必须生成新的最终文件哈希并重新检查。
- 每个文件在当前运行内独立计算轮数；`0` 表示不自动发起修复，但仍会生成回执并报告问题。
- 达到上限后，写屏障阻止当前运行继续静默覆盖该文件或执行无法明确归属目标的宿主变更。用户应先核对外部状态，再以新运行继续。
- 缺少 Office、LibreOffice、渲染器或视觉模型时不反复修改文件，列出未验证项并降级交付。
- 包损坏、主动内容、外部关系、宏或安全问题阻断交付，不得为了“通过”而删除安全部件或改用不受控重建。
- 自动修复不是无限重试，也不回放已经发生的外部副作用。工具写入成功、回执生成和最终交付通过仍是三个独立状态。

## 管理策略

管理员或用户可设置办公交付最低状态：

- `unverified`
- `structurally_valid`
- `recalculated`
- `rendered`
- `visually_verified`

还可进一步收紧最大视觉页数、最大视觉字节数和最大修复轮数。机器策略与应用策略采用更严格值，项目文件、Agent 提示词和 `full_access` 不能放宽。

Office 验证本身还受 `office.verify` 能力和执行模式限制。策略无效期间不启动新的 Office 检查。

## 桌面接口与开发者 API

原生 `office_document` 只对 WorkAgent 开放，负责实际创建、编辑和基础验证；CodeAgent 不获得该工具，不能通过项目文件、Agent 提示词或 `full_access` 绕过此模式边界。主 CodeAgent/WorkAgent 的宿主办公交付服务均可对其工作区内由其他已授权工具产生或修改的 Office 文件执行回执、PDF 证据缓存、逐页视觉批次和受控修复诊断。自动挂接只在线程为主会话、执行环境为宿主、权限为完全访问且存在工作区时启用；ChatAgent、子 Agent、沙箱执行及其他不满足条件的界面必须明确显示“已写入、交付未验证”，不能伪造宿主回执。工具可用性与宿主交付验证是两条独立边界：CodeAgent 可进入交付检查链路，但不会因此获得 WorkAgent 的 `office_document`。

开发者接口在能力返回 `officeReceipts: true` 时可查询宿主已有回执，也可通过 `POST` 的 `prepare` 和 `check` 发起宿主受控检查。`visual-batch` 和 `record-visual` 只属于桌面任务工作台的宿主内部视觉续接，不对开发者接口开放；外部尝试提交或改写视觉证据会固定返回 `403 OFFICE_EXTERNAL_VISUAL_EVIDENCE_UNTRUSTED`，且不会生成 `hostVerified: true`：

```http
GET /v1/office/receipts?sessionId=<sessionId>
Authorization: Bearer <token>
```

`prepare` 的 `path` 和可选 `sourcePath` 必须位于声明会话的工作区内且使用相对路径；绝对路径、`..` 穿越和符号链接逃逸由宿主拒绝。开发者 Office 路径与聊天内宿主路径共用同一会话模式、管理策略、`office.verify`/`file.read`、最低交付状态、阶段依赖和强制检查，不提供较弱的 API 专用验收。其余 `POST` 请求仍须在执行前重新检查策略；`/v1` 不提供任意本地文件读取或路径写入能力，回执更新仍须由宿主核对最终文件 SHA-256，文件变化后查询应返回 `stale`。

## 推荐的用户流程

1. 在 WorkAgent 中明确交付格式、受众、内容结构、品牌要求、截止条件和是否允许自动修复。
2. 让 Agent 说明是否已安装 Microsoft Office 或 LibreOffice；不要假设环境一定存在。
3. 要求保存最终文件并完成结构、公式、渲染和视觉复核；不要把模型声称“已检查”当作宿主回执。
4. 任务工作台没有回执时，只把文件视为“已写入、交付未验证”。不满足主 CodeAgent/WorkAgent、宿主、完全访问和工作区自动路径条件时，不要期待宿主补造回执；满足条件却没有回执时，应检查工具批次、运行日志和策略状态，不能把写入成功当作交付通过。
5. 已有回执时检查总状态、逐阶段状态、视觉覆盖页码和未验证项；预算中断后可从工作台继续未完成的视觉批次。
6. 对 `partial` 或 `unverified`，按回执建议人工查看具体页面或修复环境后重新验证。
7. 发布或发送前确认文件仍位于回执记录的位置且没有再次修改。

## 故障矩阵

| 现象 | 正确处理 |
| --- | --- |
| 文件生成成功但无回执 | 只表示写入成功。确认会话是否为满足条件的主 CodeAgent/WorkAgent 宿主路径；不满足时需人工或显式验收入口，满足时检查运行诊断而不是假定通过 |
| Office 未安装 | 尝试配置的 LibreOffice；否则保留结构结果并标未验证 |
| Office 正在使用 | 不接管用户进程，使用临时副本或降级 |
| Excel 公式缓存存在 | 仍区分缓存检查与真实重算 |
| PDF 导出成功 | 仍需逐页视觉复核，导出不等于通过 |
| 视觉模型不可用 | 保留结构、重算和渲染结果，视觉项标未验证 |
| 页面预算耗尽 | 展示已检查页码和覆盖比例，允许手动继续 |
| 页图缺页 | 记录具体页码，总状态不得完整通过 |
| 文件被外部修改 | 回执变为 `stale`，重新生成绑定新哈希的回执 |
| 达到 3 轮修复上限 | 停止自动修改，列出剩余问题并交人工处理 |

## 当前验证边界

以下项目必须保留为未验证，除非有本版本的现场证据：

- Office 交付服务 focused 已有 **19/19** 通过，其中隔离 LibreOffice 实际渲染约 **9.2 秒**，源文件保持不变，完成后未发现残留 `soffice`；取消路径已确认不写回执或修订。另一次 office-document 范围为 **34 项通过、3 项环境跳过**，跳过不能计为通过。
- 治理 UI native 中的 XLSX 场景使用受控 `SystemRoot`，环境中没有 PowerShell，Microsoft Office COM 启动返回 `ENOENT`，隔离 LibreOffice 也失败；该场景只能得到 `recalc failed`、`render unavailable`、公式部分覆盖和 `unverified`。它不是“Office/LibreOffice 均未安装”的干净三环境证据，也不能作为重算或渲染成功。
- 较早的纯服务 focused 等不同层级有重叠，不能把这些数字相加成全量通过。
- 真实 Microsoft Office COM 重算与 PDF 渲染。
- LibreOffice 在代表性 Windows 字体和打印机环境中的分页一致性。
- 真实视觉模型对多页长文档的逐页判断质量。
- Office、LibreOffice、两者均未安装的完整三环境矩阵。
- 同一文件在 Word、Excel、PowerPoint、WPS 和替代阅读器中的完整往返兼容。
- 断网、权限拒绝、Office 崩溃、磁盘耗尽和强制终止后的恢复。
- 正式安装包中的资源回读与安装、升级、卸载验收。

Windows Job Object 隔离与持续的外部 writer 大小监控仍未实装。公式错误对象与 PPTX 截断传播已纳入本机 `office-document` 定向的 **34 项通过、3 项环境跳过**，但跳过项和完整 GUI 自动路径不能计为通过。渲染成功也不等于视觉检查成功：没有 renderer 时渲染为 `unavailable/unverified`，强制 `requiredRender` 时阻断；renderer 成功但视觉 inspector 缺失、被关闭或预算耗尽时仍为 `partial/unverified` 并列出具体缺页。应用不会自动安装 Office。

结构合法、页面可渲染或模型判定通过，都不能证明任意 Office 文件无损、公式绝对正确、视觉完全无缺陷或内容来源合法。
