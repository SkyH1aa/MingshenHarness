# 1.3.2 文档工具能力与用法

首次联网核对：2026-11-10；最后更新：2026-11-11。本文描述当前源码支持的能力，不代表任意 Office 文档、完整 TeX 或所有排版场景都已验证。当前测试及未完成边界见 [1.3.2 验证记录](VALIDATION_1.3.2.md)，此前的文档工具验证见 [1.3.1 验证记录](VALIDATION_1.3.1.md)。

## 工具选择

使用 `create_document` 在工作区制作文件，使用 `read_document` 或 `read_file` 回读。沿用同一个受控写入工具，不需要让 Agent 自行安装 Office、Python、Pandoc 或额外下载转换器。用户要求 Word 可编辑公式时，选择 DOCX 的 `equation` 或 `rich_paragraph`，不要把 LaTeX 填入普通段落后声称已转换。

| 能力 | DOCX | PDF | PPTX |
| --- | --- | --- | --- |
| 标题、段落、列表、表格、本地 PNG/JPEG | 支持 | 支持 | 支持 |
| 原生可编辑数学公式 | OMML | 不适用，输出排版结果 | 暂不支持 |
| Markdown 与其中的数学公式 | 转为原生内容 | 离线排版 | 暂不支持 |
| 混合格式、链接、行内公式 | `rich_paragraph` | `rich_paragraph` | 使用既有文字块 |
| 表格单元格内多段、富文本与公式 | 原生文字和 OMML | 富文本与公式排版 | 仅纯文本单元格 |
| 代码块、引用 | 支持 | 支持 | 暂不支持这些块 |
| 脚注、自动目录 | 原生结构/TOC 域 | 暂不支持 | 暂不支持 |
| 页眉、页脚、页码、边距 | 支持 | 支持 | 不使用这些文档参数 |
| 原生图表及内嵌数据工作簿 | 支持 | 暂不支持 | 支持 |
| 已有模板占位段落填充 | 支持 | 不适用 | 暂不支持 |
| 幻灯片、备注、位置框 | 不适用 | 不适用 | 支持 |

DOCX 的目录和页码属于真实字段，准确目录页码需要在 Word 中更新域。PDF 公式使用 KaTeX 生成 MathML，再由内置 Chromium 排版；不是 Word 可编辑公式，也不是把 PDF 变成 Office 文档。现阶段不是通用 Office 编辑器，不提供任意旧稿的无损重排、批注/修订工作流、宏执行或完整 LaTeX 项目编译。

## 原生公式和 Markdown

以下是 `create_document` 的 JSON 参数。JSON 中的反斜杠必须写成 `\\`：

```json
{
  "path": "数学说明.docx",
  "title": "二次方程说明",
  "page_size": "A4",
  "page_numbers": true,
  "blocks": [
    {"type": "heading", "text": "求根公式", "level": 1},
    {"type": "equation", "latex": "x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}"},
    {"type": "rich_paragraph", "runs": [
      {"type": "text", "text": "当 ", "bold": true},
      {"type": "equation", "latex": "b^2-4ac\\ge0"},
      {"type": "text", "text": " 时存在实数根。"},
      {"type": "footnote", "text": "此处假设 a 不为零。"}
    ]},
    {"type": "markdown", "text": "## 检查\n\n- **保留公式结构**\n- 行内公式 $x^2$\n\n```tex\n这里的 $x$ 是代码原文\n```"}
  ]
}
```

支持常见分式、根式、上下标、积分、求和、矩阵、`cases` 和 `aligned`。公式块可带或不带 `$…$`、`$$…$$`、`\(…\)`、`\[…\]` 分隔符。Markdown 通过分隔符识别公式，不猜测任意裸 TeX 片段。代码块中的公式符号保持原文。普通文本 run 可设 `bold`、`italic`、`underline`、`strike`、`code` 和 `link`；链接仅允许 HTTP、HTTPS、mailto。

未知或无效的数学命令会明确报错，既不写半份输出，也不偷偷改成图片/带符号原文。不是完整 TeX 引擎，不加载任意宏包；个别 LaTeX 样式不能与 Office 完全等价。`read_document` 对 OMML 补充最多前 128 个公式的线性文字摘要，分子分母、上下标位置及分页不能靠文字回读验证。

Markdown 支持标题、嵌套列表、表格、代码、引用和链接。原始 HTML 转义，不执行脚本；Markdown 图片地址拒绝读取，图片应改用单独批准读取的 `image` 块。

## 表格单元格

DOCX 和 PDF 的 `table.rows` 单元格既接受原有字符串，也接受 `{"blocks":[...]}`。需要在单元格中放置公式、不同格式的文字或多个段落时，使用结构化单元格。例如，将下列块放入 `create_document` 的 `blocks`：

```json
{
  "type": "table",
  "header": true,
  "rows": [
    ["说明", "结果"],
    ["分式", {
      "blocks": [
        {"type": "paragraph", "text": "计算结果"},
        {"type": "equation", "latex": "\\frac{1}{2}"},
        {"type": "rich_paragraph", "runs": [
          {"type": "text", "text": "其中 "},
          {"type": "equation", "latex": "x^2"},
          {"type": "text", "text": " 可编辑。"}
        ]},
        {"type": "markdown", "text": "**加粗**与 $y^2$"}
      ]
    }]
  ]
}
```

结构化单元格允许 `paragraph`、`rich_paragraph`、`equation`、`markdown`、`list`、`code`、`quote`。DOCX 中的公式保持原生 OMML，可在 Word 中编辑；PDF 输出相应排版结果。普通字符串保持字面文字，里面的 `$…$`、反斜杠或 Markdown 符号不会自动转换。字符串表头仍自动加粗；结构化表头按其块和文字 run 的显式格式生成。

每个结构化单元格最多 50 个块、合计 20,000 个文字字符，并计入整个文档的块数和文字上限；模板填充也适用。单元格内不接受独立的 `table`、`image`、`chart`、`page_break`、目录或标题块，也不接受 `position`；Markdown 自身的 GFM 表格可转换为嵌套表格。PPTX 表格继续只接受字符串单元格，传入 `{"blocks":[...]}` 会明确报错。

## 图表

DOCX 和 PPTX 支持横向条形、柱形、折线与饼图，保留图表及内嵌 XLSX 数据：

```json
{
  "type": "chart",
  "chart_type": "column",
  "title": "测试通过数",
  "categories": ["第一轮", "第二轮"],
  "series": [{"name": "通过", "values": [12, 18], "color": "#168B82"}]
}
```

每个序列的值数必须与类别数相同。饼图只接受一个非负且非全零序列。条形/柱形数轴包含零。PPTX 图表可指定既有 `position:{x,y,w,h}`，单位为英寸。图表不是图片或模拟色块；复杂混合图、百分比格式及任意图表样式未在这个接口中开放。

## 模板填充

在模板中放置唯一、独占普通段落的 `{{body}}`，然后传：

```json
{
  "path": "填充后.docx",
  "template": {
    "path": "模板.docx",
    "replacements": [{
      "placeholder": "body",
      "blocks": [
        {"type": "heading", "text": "计算结果", "level": 1},
        {"type": "equation", "latex": "\\sqrt{x^2+y^2}"}
      ]
    }]
  }
}
```

标记允许跨文字 run，但必须完整匹配、唯一且独占段落。缺失、重复、嵌在句中，或涉及修订、书签、批注、字段、绘图、内容控件和分节属性时拒绝填充。签名或含宏模板也拒绝，同时检查包内文件名、内容类型和关系声明。模板必须经过独立读取权限检查；默认另存，只有用户明确要求时才 `overwrite:true`。外部修改冲突和写入审批仍然生效。

模板模式不同时传顶层 `blocks/slides` 或文档标题、作者、页眉页脚、页码、边距、纸张、方向，也不新增目录字段。`font` 用于新增的直接文字块；Markdown/列表沿用模板样式，代码和数学使用各自字体，不改变模板原有文字。模板图片/图表目前要求单节、单栏、明确页面尺寸和边距的正文占位段落，按模板实际正文宽高缩放；表格单元格、页眉页脚、分栏等媒体位置会明确拒绝，纯文字和公式不受这项媒体限制。保留模板周边内容及原有版式，不承诺所有第三方扩展、嵌入对象或复杂文档都能无损往返。

## 容量和权限

- 单次参数最多 1 MiB，文字最多 500,000 字符、内容块合计最多 1,000 个，输出最多 25 MiB，图片总计最多 20 MiB，PPTX 最多 100 张。
- 每个结构化表格单元格最多 50 个块、合计 20,000 个文字字符；单元格内容计入文档总量，模板填充使用相同限制。
- 单个 Markdown 块最多 100,000 字符、5,000 个解析节点、128 个公式；单公式最多 10,000 字符，花括号嵌套最多 64 层。
- 图片只从经批准的工作区路径读取。生成不会从 Markdown/HTML 地址获取远程媒体。
- 既有 Plan、patch-only、Agent profile、审批、隔离、writer lease、原子提交、版本冲突和取消边界保持。新增格式能力不扩大文件授权。
- 生成成功后回读实际文件。结构检查证明原生元素和关联存在；Word/PowerPoint 视觉及交互验收需用相应排版引擎另行验证，不能用 Mammoth HTML 或 XML 检查冒充。

## 开发验证

先构建实验版，再在仓库根目录执行 `node scripts/document-authoring-smoke.mjs`。脚本使用独立临时配置和本地模型服务，验证真实工具调用、原生结构、公式错误、覆盖保护及审批拒绝，并在 `.impeccable/review/` 下输出本次证据目录。`node scripts/document-asar-smoke.cjs` 单独验证实际 ASAR 中的文档依赖、公式、图表、离线读取和 OCR，不等于正式安装包验收。

本机装有 Microsoft Word 时，可额外使用 `scripts/document-office-render-smoke.ps1`。传入上一项成功生成的 `-EvidenceDirectory` 和可用的 `-PdfToPpm` 路径。该脚本只接受本仓库验收目录，禁用宏、不加入最近文件，打开生成的夹具导出页面，并在单独副本中修改公式后保存重开；若 Word 实例已有文档则拒绝操作。输出位于该次证据目录的 `word-render/`。这是可选的开发验收工具，应用运行和原生公式生成不依赖安装 Word。

1.3.2 表格专项中，Word 实际识别了单元格内 10 个原生公式，修改其中一个后保存、重开仍可编辑；模板中另有 2 个表格公式通过核验。Word 导出的 6 页和工具生成 PDF 的 6 页均已实际查看，覆盖分式、方框、cases、积分、点标记、中文和行内混排。此前 1.3.1 的正文公式、脚注及 Markdown 验证保留为历史证据；当前命令、失败重跑和边界见 [1.3.2 验证记录](VALIDATION_1.3.2.md)，不能扩展为所有第三方 Office 文档的兼容保证。

## 官方资料

本次联网核对以下一手资料，并用当前安装的 `docx 9.15.3`、`PptxGenJS 4.0.1` 进行本地实现和测试。上游网页会更新，运行能力以固定依赖和实际测试为准：

- [docx LaTeX 数学转换](https://raw.githubusercontent.com/dolanmiu/docx/master/docs/usage/math-latex.md)：`latexToMath` 生成 Word 数学组件。
- [Microsoft OfficeMath](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.math.officemath?view=openxml-3.0.1)：`m:oMath` 结构。
- [docx HTML 转换](https://raw.githubusercontent.com/dolanmiu/docx/master/docs/usage/html.md)。
- [docx 图表](https://raw.githubusercontent.com/dolanmiu/docx/master/docs/usage/charts.md)。
- [docx 模板 patcher](https://raw.githubusercontent.com/dolanmiu/docx/master/docs/usage/patcher.md)。
- [PptxGenJS 图表](https://gitbrent.github.io/PptxGenJS/docs/api-charts/)。
- [KaTeX 输出与错误选项](https://katex.org/docs/options)。
- [Marked 独立实例和扩展配置](https://marked.js.org/using_advanced)。
