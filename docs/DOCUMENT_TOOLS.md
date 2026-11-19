# 1.3.3 文档工具能力与用法

首次联网核对：2026-11-10；最后更新：2026-11-17。本文描述当前源码支持的能力，不代表任意 Office 文档、完整 TeX 或所有排版场景都已验证。当前测试及未完成边界见 [1.3.3 验证记录](VALIDATION_1.3.3.md)，此前的文档工具验证见 [1.3.2 验证记录](VALIDATION_1.3.2.md)及 [1.3.1 验证记录](VALIDATION_1.3.1.md)。

## 工具选择

使用 `create_document` 在工作区制作通用 DOCX/PDF/PPTX，使用 `office_document` 检查和受控编辑既有 Office 文件，再使用 `read_document` 或 `read_file` 回读。`office_document` 属于 WorkAgent 专精工具；CodeAgent 使用编码工作流，ChatAgent 不获得本地 Office 文件修改能力。沿用受控文件网关，不需要让 Agent 自行安装 Office、Python、Pandoc 或额外下载转换器。用户要求 Word 可编辑公式时，选择 DOCX 的 `equation` 或 `rich_paragraph`，不要把 LaTeX 填入普通段落后声称已转换。

| 能力 | DOCX | PDF | PPTX |
| --- | --- | --- | --- |
| 标题、段落、列表、表格、本地 PNG/JPEG | 支持 | 支持 | 支持 |
| 原生可编辑数学公式 | OMML | 不适用，输出排版结果 | 暂不支持 |
| Markdown 与其中的数学公式 | 转为原生内容 | 离线排版 | 暂不支持 |
| 混合格式、链接、行内公式 | `rich_paragraph` | `rich_paragraph` | 使用既有文字块 |
| 表格单元格内多段、富文本与公式 | 原生文字和 OMML | 富文本与公式排版 | 仅纯文本单元格 |
| 代码块、引用、重点提示卡 | 支持 | 支持 | `callout` 使用原生形状与文字 |
| 脚注、自动目录 | 原生结构/TOC 域 | 暂不支持 | 暂不支持 |
| 页眉、页脚、页码、边距 | 支持 | 支持 | 使用原生页脚、页码；不使用 Word 页眉和文档边距参数 |
| 原生图表及内嵌数据工作簿 | 支持 | 暂不支持 | 支持 |
| 已有模板占位段落填充 | 支持 | 不适用 | 暂不支持 |
| 无占位符旧稿局部替换、段落排版 | 支持，受保护结构拒绝 | 不适用 | 暂不支持 |
| 段间距、行距、缩进、分页控制、列宽比例 | 支持 | 支持 | 暂不支持这些参数 |
| 幻灯片、备注、位置框 | 不适用 | 不适用 | 支持 |
| 成套设计预设、封面与信息层级 | 支持 | 支持 | 支持彩色主题、封面和多种原生版式 |
| 报表式表头、正文字体与打印布局 | 不适用 | 不适用 | XLSX 的 title/header/body range、网格线和打印设置 |

DOCX 的目录和页码属于真实字段，准确目录页码需要在 Word 中更新域。PDF 公式使用 KaTeX 生成 MathML，再由内置 Chromium 排版；不是 Word 可编辑公式，也不是把 PDF 变成 Office 文档。现阶段不是通用 Office 编辑器，不提供任意旧稿的无损重排、批注/修订工作流、宏执行或完整 LaTeX 项目编译。

## WorkAgent Office 文件操作

`office_document` 将结构检查、结构化编辑和可选的宿主 Office 验证放在同一个受控工具中。所有路径都来自当前工作区并经过读取/写入审批、版本冲突检查、writer lease 和原子提交；不因为传入 Office 文件而增加任意本地路径权限。

### 检查文件

```json
{"operation":"inspect","path":"工作簿.xlsx"}
```

`inspect` 支持 DOCX、XLSX、PPTX，返回源文件 SHA-256、工作表/单元格或 PPTX 幻灯片/形状/表格/备注结构。结果最多索引固定数量的非空单元格和对象；它是 OOXML 结构证据，不是 Office 版面渲染。

### Excel 创建与编辑

创建工作簿：

```json
{
  "operation":"create_spreadsheet",
  "path":"周报.xlsx",
  "overwrite":false,
  "workbook":{
    "design":{"preset":"consulting","accent":"1F4E78"},
    "sheets":[{
      "name":"汇总",
      "freeze":{"row":1,"column":1},
      "columns":[{"index":1,"width":24},{"index":2,"width":16}],
      "cells":[
        {"row":1,"column":1,"value":"指标","style":{"font":{"bold":true},"fill":"1F6F78"}},
        {"row":2,"column":1,"value":"收入"},
        {"row":2,"column":2,"value":1200},
        {"row":3,"column":1,"value":"成本"},
        {"row":3,"column":2,"value":700},
        {"row":4,"column":1,"value":"差额"},
        {"row":4,"column":2,"value":{"formula":"B2-B3"}}
      ],
      "merges":[],
      "tables":[{"name":"SummaryTable","range":"A1:B3","style":"TableStyleMedium2"}],
      "filter":"A1:B3",
      "presentation":{
        "title_range":"A1:B1",
        "header_range":"A2:B2",
        "body_range":"A3:B4",
        "show_grid_lines":false,
        "print_area":"A1:B4",
        "print_titles_rows":"2:2",
        "orientation":"landscape",
        "fit_to_page":true
      }
    }]
  }
}
```

创建和编辑支持字体、填充、边框、对齐、数字格式、单元格公式、合并/取消合并、列宽/隐藏、冻结窗格、筛选及原生 Excel 表格。`workbook.design` 和 sheet 的 `presentation` 提供 `executive`、`consulting`、`editorial`、`minimal` 四种成套报表表面；`title_range/header_range/body_range` 分别设置标题、表头和正文区，另可关闭网格线、设置打印区域、重复标题行、页面方向和单页宽度适配。这些范围必须由调用者根据真实内容指定，生成器不会把空白区当成设计元素。公式对象中的 `formula` 会写入工作簿；调用者提供的 `result` 即使出现在文件中，也只是缓存初值，不能证明公式已由 Microsoft Excel 重算。

先 `inspect` 既有 XLSX，取得完整 SHA-256，再执行 SHA 绑定的编辑：

```json
{
  "operation":"edit_spreadsheet",
  "path":"周报-修订.xlsx",
  "overwrite":false,
  "source":{"path":"周报.xlsx","expected_sha256":"在此填入64位SHA256"},
  "operations":[
    {"type":"set_cells","sheet":"汇总","cells":[{"row":5,"column":1,"value":"备注"}]},
    {"type":"style_range","sheet":"汇总","range":"A1:B1","style":{"font":{"bold":true}}},
    {"type":"freeze","sheet":"汇总","row":1,"column":0},
    {"type":"filter","sheet":"汇总","range":"A1:B5"},
    {"type":"format_sheet","sheet":"汇总","presentation":{
      "preset":"executive",
      "title_range":"A1:B1",
      "header_range":"A2:B2",
      "body_range":"A3:B5",
      "show_grid_lines":false
    }}
  ]
}
```

支持的操作包括 `add_sheet`、`rename_sheet`、`delete_sheet`、`set_cells`、`set_range`、`append_rows`、`style_range`、`merge_range`、`unmerge_range`、`set_columns`、`freeze`、`filter`、`add_table` 和 `format_sheet`。源 SHA 不匹配会拒绝整次编辑。未参与 ExcelJS 编辑的其他 OOXML 部件按源字节恢复；宏、签名、ActiveX、OLE、外部连接、透视缓存、切片器和 Web Extension 会在编辑前拒绝，而不是静默破坏。

### PPTX 旧稿受控编辑

```json
{
  "operation":"edit_presentation",
  "path":"演示-修订.pptx",
  "overwrite":false,
  "source":{"path":"演示.pptx","expected_sha256":"在此填入64位SHA256"},
  "operations":[
    {"type":"replace_shape_text","slide":1,"shape_id":8,"old_text":"旧标题","new_text":"新标题"},
    {"type":"set_table_cell","slide":2,"table":1,"row":2,"column":2,"text":"125"},
    {"type":"replace_notes_text","slide":2,"old_text":"旧备注","new_text":"新备注"}
  ]
}
```

`replace_shape_text` 要求指定形状内的旧文字唯一且吻合；`set_table_cell` 使用从 `inspect` 得到的一基表格/行/列；`replace_notes_text` 只改演讲者备注。未修改的 ZIP 部件按源字节保留，图片替换、SmartArt、动画、OLE、宏、签名和复杂母版重排不在承诺范围。旧稿编辑后应继续 `verify`，不能只凭 XML 修改成功宣称视觉版面正确。

### 验证、重算与渲染

```json
{
  "operation":"verify",
  "path":"周报-修订.xlsx",
  "overwrite":false,
  "render":true,
  "recalculate":true,
  "timeout_ms":60000,
  "render_path":"周报-检查.pdf",
  "output_path":"周报-重算.xlsx"
}
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `render` | `true` | 请求 PDF 导出；XLSX 也用于版面检查 |
| `recalculate` | `false` | 仅 XLSX；请求 Microsoft Excel 重算 |
| `timeout_ms` | `60000` | 宿主验证超时，范围 5,000–180,000 ms |
| `render_path` | 未设置 | 必须是 `.pdf`，不得覆盖验证源文件 |
| `output_path` | 未设置 | 必须是 `.xlsx`，只用于保存重算后的工作簿 |
| `overwrite` | `false` | PDF/XLSX 输出已存在时默认拒绝覆盖 |

结构检查始终先执行。宿主 COM 只在 Windows、`full_access + host + WorkAgent + 非子 Agent` 时尝试；必须已安装对应 Microsoft Office，不在后台安装 Office，也不调用用户可见的浏览器或云端转换器。检测到同类 Office 已运行时直接降级并保留结构检查，不关闭用户现有 Office 会话。应用为每次 COM 验证创建独立临时副本，并在启动自动化前检查 OOXML 的非普通超链接外部关系、Word 跨 run 自动字段以及 XLSX 数据连接部件；命中时仍完成结构检查，但不打开 COM，避免在验证过程中解析外部模板、图片、数据或自动内容。普通超链接可保留，此预检只约束可选 COM 路径，不改变普通 `inspect/edit` 的既有支持范围。

COM 实例的接管顺序是：创建隐藏实例、由 HWND 精确确认 PID/名称/可执行路径/创建时间和 `/Automation -Embedding` 命令行、检查 `Documents/Workbooks/Presentations.Count` 为零，全部成立后才写入可清理的 owner 记录并打开文档。实例非空或无法证明为空时不登记 owner，因此不会按该 PID 清理，也不会对其文档执行 `Close/Quit`；已有实例身份不匹配时同样不会按进程名结束。只有成功登记的本次实例会在正常退出、超时或取消后再次核对完整身份，再进行精确清理。失败与超时会移除隔离路径并报告脱敏后的最后阶段，例如创建实例、打开、重算或渲染，便于区分产品错误与 Office 权限、激活或隔离限制；阶段诊断本身不构成渲染通过。

Excel 的真实重算结果会检查公式错误值和缺失缓存；只有 Microsoft Excel 返回并保存的工作簿才算重算证据。`render_path` 生成的是导出文件，仍需视觉能力逐页检查裁切、重叠、分页和字体替换。Word/PowerPoint 的实际渲染同样不能由 OOXML 结构检查替代；Office 未安装、正在使用、被权限/隔离策略阻止或超时，都必须在结果中标记“未验证”，不能报成渲染通过。

### PPTX 原生排版

`create_document` 的 PPTX 使用 `slides`，每页可以只有标题作为封面/章节页，也可以包含文字、纯文本表格、图片和原生图表：

```json
{
  "path":"季度复盘.pptx",
  "title":"季度复盘",
  "footer":"内部资料 | Mingshen Harness",
  "design":{"preset":"consulting","density":"airy"},
  "slides":[
    {"kind":"cover","eyebrow":"经营复盘","title":"季度复盘"},
    {
      "kind":"cards",
      "eyebrow":"优先事项",
      "title":"关键变化",
      "blocks":[
        {"type":"list","items":["改善回款质量","缩短交付周期","稳定关键客户"]}
      ]
    },
    {
      "kind":"timeline",
      "eyebrow":"未来30天",
      "title":"按证据推进",
      "blocks":[{"type":"list","ordered":true,"items":["确认负责人","发布基线","启动首轮","复盘"]}]
    },
    {
      "kind":"data",
      "title":"三个核心指标均在决策区间内",
      "blocks":[{"type":"metric_grid","columns":3,"metrics":[
        {"value":"92%","label":"准时交付","detail":"高于计划2个百分点"},
        {"value":"18天","label":"周期","detail":"较计划少3天"},
        {"value":"4.6","label":"质量分","detail":"较计划高0.1"}
      ]}]
    }
  ]
}
```

生成器使用冰白、深墨青和矿青的商务主题，提供深色封面、统一标题层级、页眉细线、页脚和页码；表格与图表保留为原生可编辑对象。`design.preset` 可选择成体系的主题，`design.density` 使用 `airy/balanced/compact` 调整标题起点、块间距以及卡片、时间线和 KPI 网格的节奏。`slide.kind` 支持 `auto/cover/section/content/statement/cards/timeline/data/closing`。`cards` 把 2–6 个无序列表项排成原生卡片，`timeline` 把 3–6 个有序步骤排成时间线，`metric_grid` 用 2–6 个真实指标生成原生 KPI 卡。`callout` 用原生形状呈现一个结论边界、风险或行动提示，`title/text/tone` 分别设置提示标题、内容和 `accent/positive/warning/neutral` 语气。`slide.eyebrow` 是短眉题，不应重复页面标题。布局由内容证据决定，不要为了版式填充不存在的数字或步骤。

块可以传 `position:{x,y,w,h}`（英寸），用于影响自动流的位置和尺寸，但必须位于 13.333 × 7.5 英寸画布内。PPTX 不接受 DOCX 段落 `layout`、`column_widths`、富文本表格单元格、独立公式、Markdown、代码、引用或自动目录；`metric_grid` 也只用于 PPTX。需要这些结构时应改用 DOCX/PDF。PPTX 的 `header/page_numbers/margins` 仍拒绝，顶层 `footer` 作为幻灯片页脚文字使用。

### DOCX/PDF 设计预设

新生成的 DOCX/PDF 可设置顶层 `design`：

```json
{"design":{"preset":"editorial","density":"balanced","accent":"#8B4034","cover_page":true}}
```

`executive`、`consulting`、`editorial`、`minimal` 应用不同的文字、背景、强调和表格配色；`airy/balanced/compact` 调整纵向节奏。`cover_page` 为较长的 DOCX/PDF 生成标题页；未指定时，四块及以上的标题文档默认启用封面。模板填充和旧稿编辑继续保留原有版式，不接受新设计参数。主题只能建立一致起点，不能替代逐页内容、排版和渲染检查。

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

模板模式不同时传顶层 `blocks/slides` 或文档标题、作者、页眉页脚、页码、边距、纸张、方向，也不新增目录字段。`font` 用于新增的直接文字块；Markdown/列表沿用模板样式，代码和数学使用各自字体，不改变模板原有文字。模板图片、图表和指定列宽的表格目前要求单节、单栏、明确页面尺寸和边距的正文占位段落，按模板实际正文宽高缩放；表格单元格、页眉页脚、分栏等位置会明确拒绝，纯文字和公式不受这项尺寸限制。保留模板周边内容及原有版式，不承诺所有第三方扩展、嵌入对象或复杂文档都能无损往返。

## 旧稿局部编辑

1.3.3 不再要求旧稿预埋 `{{placeholder}}`。先调用 `read_document`（或 `read_file`）读取结构：

```json
{"path":"旧稿.docx","structure":true}
```

返回源文件完整 SHA-256、正文 block 编号和 paragraph 编号，以及各段文字、样式和保护提示。编号从 1 开始，block 是正文直属元素，paragraph 包含表格单元格；页眉页脚不在编辑索引中。长结果使用原有读取游标分页。公式文字只是线性定位摘要，不能还原二维排版。

然后把真实 SHA-256 填入 `edit.expected_sha256`：

```json
{
  "path":"修订稿.docx",
  "edit":{
    "path":"旧稿.docx",
    "expected_sha256":"在此填入结构读取结果的64位SHA256",
    "operations":[
      {"type":"replace_text","paragraph":2,"old_text":"旧文字","new_text":"修订文字"},
      {"type":"replace_blocks","start_block":3,"end_block":4,"blocks":[
        {"type":"heading","text":"修订章节","level":2},
        {"type":"equation","latex":"x^2+1"}
      ]},
      {"type":"format_paragraph","paragraph":8,"layout":{"line_spacing":1.5,"space_after":8}}
    ]
  }
}
```

- `replace_text` 精确匹配选定普通段落中的唯一行内文字，支持跨加粗、斜体等 run；周边 run 格式保留，新增文字继承首个受影响 run。允许空 `new_text` 删除文字，不接受换行或制表符。表格内普通文字段落同样可改；公式、图片和字段段落不能用此操作。
- `replace_blocks` 替换完整正文段落/表格的闭区间，新内容支持现有富文本、公式、表格、图片和图表；`blocks:[]` 删除区段。删除全部正文后保留一个空段落。插入富内容目前要求原稿使用标准 `w:` 前缀；其他 Word 前缀仍可做行内文字及段落排版修改。
- `format_paragraph` 只改指定段落的排版属性，不重建原有文字和公式。一次最多 100 项操作，全部定位于编辑前的同一快照；目标不能相交或包含彼此，改完后重新读取结构。

源 hash 不符、旧文字缺失/重复、越界或重叠会明确失败，不提交部分修改。书签、批注、跨段字段/权限范围、修订、内容控件、分节、脚注引用和保护对象等选区拒绝修改；可拆成不涉及它们的区段。签名或含宏文件拒绝。`edit` 与 `template` 互斥，不同时设置顶层内容或文档级版式。

默认另存，原稿读取仍需独立权限及审批。行内修改/排版/删除只改变 `word/document.xml` 的内容，其余包内部件保留原始字节；插入新富内容时，必要的正文关系、样式、编号和脚注等部件可能更新，无关页眉、页脚、媒体、原图表和元数据按原部件保留。ZIP 与正文 XML 会重新序列化，不能承诺文件字节相同、任意 Office 扩展无损往返或改字后分页完全不变；复杂受保护结构会拒绝而非自动扁平化。

## 精细排版

DOCX/PDF 的 `heading`、`paragraph`、`rich_paragraph`、`equation` 可传 `layout`，同一结构也用于旧稿 `format_paragraph`：

```json
{"type":"paragraph","text":"正文","layout":{"align":"justify","line_spacing":1.5,"first_line_indent":0.25,"space_after":8,"keep_together":true}}
```

| 参数 | 单位或取值 |
| --- | --- |
| `align` | left / center / right / justify，优先于旧 `align` |
| `space_before`、`space_after` | 磅，0–144 |
| `line_spacing` | 行距倍数，0.8–3 |
| `first_line_indent` | 英寸，0–2 |
| `indent_left`、`indent_right` | 英寸，0–3 |
| `keep_with_next`、`keep_together`、`page_break_before` | 布尔值，分别控制与下段同页、段中不分页、段前分页 |

表格使用 `column_widths:[1,3]` 指定相对列宽，数量须与列数一致；DOCX 写入固定网格和真实单元格宽度，PDF 使用同样比例。DOCX 过窄列会明确拒绝。`header:true` 保留重复表头。旧稿/模板中指定列宽的表格按实际正文宽度计算，仅支持尺寸明确的单节单栏正文。PPTX 不接受这些排版参数。

独立 Word 公式同时设置数学段落对齐属性，避免只设置普通段落却仍被 Word 默认居中；行内公式随文字段落排版。独立公式的 `justify` 按左对齐处理，不拉伸数学符号。

## 容量和权限

- 单次参数最多 1 MiB，文字最多 500,000 字符、内容块合计最多 1,000 个，输出最多 25 MiB，图片总计最多 20 MiB，PPTX 最多 100 张。
- 每个结构化表格单元格最多 50 个块、合计 20,000 个文字字符；单元格内容计入文档总量，模板填充使用相同限制。
- 单个 Markdown 块最多 100,000 字符、5,000 个解析节点、128 个公式；单公式最多 10,000 字符，花括号嵌套最多 64 层。
- 图片只从经批准的工作区路径读取。生成不会从 Markdown/HTML 地址获取远程媒体。
- 既有 Plan、patch-only、Agent profile、审批、隔离、writer lease、原子提交、版本冲突和取消边界保持。新增格式能力不扩大文件授权。
- 生成成功后回读实际文件。结构检查证明原生元素和关联存在；Word/PowerPoint 视觉及交互验收需用相应排版引擎另行验证，不能用 Mammoth HTML 或 XML 检查冒充。

## 开发验证

先构建实验版，再在仓库根目录执行 `node scripts/document-authoring-smoke.mjs`。脚本使用独立临时配置和本地模型服务，验证真实工具调用、原生结构、公式错误、覆盖保护及审批拒绝，并在 `.impeccable/review/` 下输出本次证据目录。`node scripts/document-asar-smoke.cjs` 单独验证实际 ASAR 中的文档依赖、公式、图表、离线读取和 OCR，不等于正式安装包验收。

设计版夹具由 `office-craft-fixtures.test.ts` 生成。设置绝对证据目录后运行：

```powershell
$env:OFFICE_CRAFT_EVIDENCE="C:\path\to\evidence"
pnpm --filter @mingshen/desktop exec vitest run src/main/documents/office-craft-fixtures.test.ts --reporter=dot
```

输出 DOCX、XLSX、PPTX 和包含 SHA/大小/布局清单的 `fixture-result.json`。PPTX 覆盖封面、观点、卡片、时间线、KPI 和结尾页，XLSX 覆盖报表头、正文、隐藏网格线和打印设置。测试只证明原生文件已生成且可解析；PowerPoint/Word 逐页视觉验收仍需在允许的 Office 渲染路径中另行执行。

确认没有正在使用的 Word/Excel/PowerPoint，并且执行策略允许隔离 COM 时，可追加 `$env:OFFICE_CRAFT_RENDER="1"`。测试会逐文件串行调用最多 30 秒的可选 Microsoft Office 验证：三个格式都尝试导出 PDF，XLSX 同时重算并写出计算后副本。每个文件保存 `*.render-receipt.json`，成功时另存 `*.rendered.pdf` 和 `*-recalculated.xlsx`，汇总在 `render-receipts.json`；失败或不可用如实保留而不算通过，源字节哈希必须保持不变。该开关不会在普通测试中自动启用。

本机装有 Microsoft Word 时，可额外使用 `scripts/document-office-render-smoke.ps1`。传入上一项成功生成的 `-EvidenceDirectory` 和可用的 `-PdfToPpm` 路径。该脚本只接受本仓库验收目录，禁用宏、不加入最近文件，打开生成的夹具导出页面，并在单独副本中修改公式后保存重开；若 Word 实例已有文档则拒绝操作。输出位于该次证据目录的 `word-render/`。这是可选的开发验收工具，应用运行和原生公式生成不依赖安装 Word。

1.3.3 最终定向测试193项通过/1项跳过，真实Electron文档专项18/18组通过，覆盖无占位符旧稿编辑、原部件保留、源SHA冲突及精细排版。Word COM导出的8页和工具生成PDF的8页均已逐页查看；Word实测首行18pt、段后8pt、1.5倍行距、两端对齐、段中不分页、3:1列宽及独立公式左对齐。正文/表格原生公式修改后保存、重开仍可编辑，修订稿的原页眉/页脚/图片/脚注保留。当前环境缺少LibreOffice，标准技能渲染器尝试未通过，未认证其兼容性。命令、修复前结果和完整边界见 [1.3.3 验证记录](VALIDATION_1.3.3.md)。

1.3.2 表格及1.3.1正文公式、脚注、Markdown验证继续保留为历史证据，不能扩展为所有第三方Office文档的兼容保证。当前仍不支持任意受保护结构编辑或任意旧稿无损往返；Markdown默认排版也没有在本轮全面重写。

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
