# WorkAgent Office Quality Research for 1.3.3

最后核对日期：2026-11-17（Asia/Shanghai）。

本文只记录本轮实际读取的 ZCode 与 WorkBuddy 官方公开资料、阅读后能够确认和不能确认的内容，以及这些机制在当前 Mingshen Harness Office schema 和 Skill references 中的映射。本文不是竞品私有实现的复刻说明，也不证明 Mingshen Harness 已经达到同等效果。

## 1. 结论摘要

公开资料支持把高质量办公产物拆成五个相互独立的层次：

1. 需求层：读者、用途、必须支持的决定、语气、语言、篇幅和使用场景。
2. 内容层：标题形成可辩护的论证，事实、解释、建议和未知项分开。
3. 方法层：Word、Excel、PowerPoint 分别使用编辑、模型、叙事和版式工作流，而不是共用一段“专业写作”提示。
4. 执行层：使用原生可编辑对象、受控设计系统和按证据选择的结构。
5. 验收层：真实重算、导出或渲染后逐页检查，再修改源文件；打开成功或结构有效不等同于成品美观。

本轮最值得吸收的产品机制是：

- WorkBuddy：专家采用“人设 + 方法论 + 工具链”；设计产物支持风格模板、自然语言精修和所见即所得编辑；办公任务支持在同一任务中持续修改并查看产物。
- ZCode：长任务保持同一工作区上下文；Skill 只注入元数据并按需加载正文；插件把 Skill、命令、Agent、MCP 和 Hook 组成可启停能力包；Goal 需要文件、命令或测试实据才能判定完成。

不能从公开资料确认的是：两个产品具体使用的私有排版提示词、文档质量评分器、模板生成算法、设计知识库、完整 Office Skill 源码或可再分发许可证。因此本轮只借鉴公开工作流和交互模式，不复制其模板、文案、截图、品牌视觉或未公开实现。

## 2. 实际读取的公开资料

阅读日期均为 2026-11-17。以下页面均实际请求并抽取了正文。

### 2.1 WorkBuddy

| 主题 | 已确认内容 | URL |
| --- | --- | --- |
| 专家机制 | 专家使用“人设 + 方法论 + 工具链”完成任务；专家团可拆解、并行执行并整合结果。专家本身不主动扩大系统权限，配置 Skill/MCP 后才在授权下访问资源。 | [Expert Center](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Expert-Center) |
| 设计创意 | PPT、海报、网页和 App 可使用设计风格模板；支持自然语言全局修改、画布框选局部修改、每轮改动说明、浏览器端精确编辑和实时回流。PPT 可导出 PPTX 或 PDF。 | [Design Idea](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Design-Idea) |
| 文档生成与编辑 | 官方实践要求说明目标、对象、语气和结构；已有内容可继续按差异修改，不需要重写整段提示。可结合素材和模板制作演示文稿。 | [Practice Two](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Practice-Cases/Practice-Two) |
| 数据分析与报告 | 使用方应说明指标、统计维度或时间范围、图表类型和输出形式；结果包含结论、关键图表、趋势判断和行动建议。 | [Practice Three](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Practice-Cases/Practice-Three) |
| 产物查看 | 任务过程与产物、工作空间文件、变更在同一结果区中查看，可在不离开任务的情况下预览、打开或对照产物。 | [Results](https://www.workbuddy.cn/docs/workbuddy/Results) |
| 任务对话 | 可在已有任务中继续补充要求、修改结果；生成中的消息可排队；回退、编辑重发和刷新时会考虑对话及产物版本。 | [Conversation](https://www.workbuddy.cn/docs/workbuddy/Conversation) |
| Skill 管理 | 已安装 Skill 可启用、停用和卸载；关闭后不参与新任务调用。页面说明 Skill 可能包含脚本、工作流和第三方访问，需要来源和权限审查。 | [Skills Market](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market) |
| 办公文档四件套 | Search Skill 页面公开列出的能力是 PDF、DOCX、PPTX、XLSX 的读取、生成、清洗、重组和导出；没有公开高级版式算法或完整提示词。 | [Office Document Suite](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/WorkBuddy-Zero-Cost-Skill-Top-10/Office-Document-Suite) |
| Skill 规范 | 腾讯公开 Skill 文档说明三级渐进披露：元数据常驻、`SKILL.md` 触发后加载、`references/scripts/assets` 按需读取；项目级 Skill 优先，AI 会分析任务自动调用合适 Skill。 | [Tencent WorkBuddy Enterprise Skills](https://cloud.tencent.cn/document/product/1831/137452) |
| Plan 模式 | 公开文档将复杂任务拆成需求澄清、方案制定、方案编辑/确认、方案实施和完成；方案可显式编排 Skill、MCP 和 SubAgent。此页属于 WorkBuddy Enterprise/CodeBuddy 公开文档，不能扩大解释为 WorkBuddy 所有客户端均完全一致。 | [Tencent WorkBuddy Enterprise Plan Mode](https://cloud.tencent.cn/document/product/1831/134514) |

### 2.2 ZCode

| 主题 | 已确认内容 | URL |
| --- | --- | --- |
| ZCode Agent | 公开定位为长任务和稳定执行；把任务理解、文件引用、终端、浏览器、执行模式、Git 状态和 Review 收束在同一个工作区。 | [ZCode Agent](https://zcode.z.ai/cn/docs/agents) |
| 插件 | 插件可包含 Skill、命令、子 Agent、MCP 和 Hook；官方内置 `document-skills` 用于 DOCX、PDF 等文档，并默认启用。启用插件的 Skill 可在合适时机自动触发。 | [Plugin](https://zcode.z.ai/cn/docs/plugin) |
| Skill | 每轮只注入已启用 Skill 的元数据，正文按需加载；元数据共享固定预算，描述过泛或 Skill 过多会降低自动触发率。停用 Skill 不进入上下文。 | [Skill](https://zcode.z.ai/cn/docs/skill) |
| Goal 模式 | 每轮结束单独核验目标；文件、命令输出和测试结果等实据才算完成，计划和待办本身不算；未完成可自动续跑，也可暂停、恢复和保存状态。 | [Goal](https://zcode.z.ai/cn/docs/goal) |

## 3. 能确认与不能确认

### 3.1 能确认

- 高质量工作流不能只靠一条“让文档更精美”的提示。两个产品都把上下文、方法、能力、执行和验证拆开处理。
- 设计产物需要显式风格系统和多种页面语法。WorkBuddy 公开提供预设风格、全局修改和局部精修；这支持当前 Harness 使用受控 `design` 预设与 `slide.kind`，而不是让每页自由堆叠文本。
- 长文档和演示文稿需要迭代修改。只生成一次再由模型口头宣称“已优化”不足以证明质量，最好保留源对象并针对具体差异再次编辑和验收。
- Skill 应采用渐进披露。元数据负责路由，正文负责方法，reference 负责仅在特定格式或风险出现的细节，assets 负责产物资源，scripts 负责确定性操作。
- 完成判定必须依赖可核对产物。Office 场景至少需要结构检查、公式重算状态、PDF/页面渲染和逐页视觉复核，并且分别披露未执行项。

### 3.2 不能确认

- 没有找到 ZCode `document-skills` 的公开源码、完整许可证、详细排版规则、模板集或质量评分逻辑。不能据此复制其实现。
- 没有找到 WorkBuddy Office Skill 的公开高级视觉提示词、设计系统内部实现、模板授权条件或所有输出样例的生成参数。
- 不能把 WorkBuddy 的 Ardot 画布、品牌风格模板或 ZCode 插件内容直接迁移到 Mingshen Harness。它们可能受服务协议、商标、版权或私有代码约束。
- 不能仅凭文档声称某个产品“一定会输出大厂级成品”。不同模型、提示、素材、版本、订阅能力和人工精修都会影响结果。
- 不能把导出成功、OOXML 结构通过或文本抽取等同于分页、排版和视觉质量通过。

## 4. 映射到当前真实 schema

以下字段来自本轮读取的当前源码，不把未来建议写成已实现能力。

### 4.1 `create_document.design`

当前 `documentDesignSchema` 支持：

- `preset`: `executive`、`consulting`、`editorial`、`minimal`
- `density`: `airy`、`balanced`、`compact`
- `accent`: `#RRGGBB`
- `cover_page`: 仅 DOCX/PDF 使用

对应实现位于 `apps/desktop/src/main/documents/document-authoring-schema.ts`、`office-visuals.ts` 与 `document-author.ts`。预设提供有限的语义色和密度，不是任意自由配色系统；PPTX 的 `density` 已进入标题起点、内容块间距、卡片、时间线和 KPI 网格的排版计算。

公开资料映射：

- WorkBuddy 的“设计风格模板”对应这里的受控 `design.preset`。
- WorkBuddy 的“简洁/高级/极简”等风格诉求应映射到 preset、density 和单一 accent，而不是让模型逐页散落随机颜色。
- 对用户批准的品牌资产，现阶段只能在明确要求时设置 accent 或通过 DOCX 模板保留品牌版式；PPT 尚无完整品牌母版导入接口。

本轮研究不建议把 `brief`、`tone` 或 `audience` 假装为已存在字段。当前这些约束由 `resources/prompts/work.md` 的生产 brief 和对应 Skill reference 执行。若未来要确定性校验，需要另行定义新 schema。

### 4.2 `slide.kind`

当前 `slideSchema.kind` 支持：

- `auto`
- `cover`
- `section`
- `content`
- `statement`
- `cards`
- `timeline`
- `data`
- `closing`

当前还支持 `slide.eyebrow`、`notes`、`background` 和 `blocks`。实现会根据 `kind` 选择不同的标题、安全区、背景和列表构图；`auto` 会按位置推断。

公开资料映射：

- 可用 `cover` 建立主题，用 `section` 表示章节切换，用 `statement` 突出一个关键判断，用 `cards`、`timeline`、`data` 承载不同证据结构，用 `closing` 给出决策或下一步。
- 不应为了“变化”在无对应证据时滥用 `cards`、`timeline`、`data` 或 `metric_grid`。
- 当前 schema 没有任意自由画布、图层选择或设计对象双向同步。不能宣称支持 Ardot 式精确画布编辑。

### 4.3 `metric_grid`

当前 `metric_grid` 是仅 PPTX 可用的 block：

- `metrics`: 2 到 6 项
- 每项包含 `value`、`label`，可选 `detail`
- `columns`: 2 到 3

它适合表达真实的 KPI、比较值或 headline numbers。不要为了填满卡片而制造数字，也不要把无共同单位、无共同周期或不可比较的数据强行放进一组。

公开资料映射：

- 对应 WorkBuddy 数据报告中的 headline values 和“产出完整视觉报告”实践。
- 当前实现能生成原生指标卡，但没有复杂图表注释、数据标签策略、统一单位强制检查或自动来源脚注。相关约束目前由 `work-presentations` reference 和人工/模型验收承担。

### 4.4 `callout`

当前 `callout` 支持：

- 可选 `title`
- 必填 `text`
- `tone`: `accent`、`positive`、`warning`、`neutral`

它在 DOCX/PDF 中用于风险、决策护栏、原则或下一步；PPTX 中也可作为语义提示块。应限制频次，不能把每个普通段落装箱，也不能用颜色代替事实严重性。

### 4.5 Word 与 PDF 的布局字段

当前 block 的 `layout` 支持对齐、段前/段后、行距、首行及左右缩进、与下段同页、段中不分页和段前分页；表格支持 `column_widths`。当前 Word 输出还支持封面、页眉页脚、页码、目录、原生表格、原生图表、图片、公式和 `callout`。

公开资料映射：

- WorkBuddy 文档实践中的“受众、语气、结构、继续修改”映射到 `work.md` 的生产 brief、DOCX `edit` 和 Skill reference。
- 研究不能证明当前默认排版已达到特定竞品水平，尤其不能替代真实 Word 分页渲染检查。

### 4.6 Excel `workbook.design`

当前 `create_spreadsheet.workbook.design` 支持：

- `preset`
- `accent`

工作簿级设计用于建立统一色调。当前真实能力仍以单元格样式、表格、公式、固定宽度、筛选和冻结等结构化操作为主。

### 4.7 Excel sheet `presentation`

当前 `presentation` 支持：

- `preset`
- `accent`
- `title_range`
- `header_range`
- `body_range`
- `show_grid_lines`
- `print_area`
- `print_titles_rows`
- `orientation`
- `fit_to_page`

它把工作表从原始单元格网格提升为可打印、可浏览的报告表面。v1.3.3 当前实现会处理标题、表头、正文带、网格线、打印区域、重复标题行、横竖向和按页适配。

公开资料映射：

- 对应 WorkBuddy 数据分析实践的“结构化数据、图表、结论与可视化报告”，但当前 `presentation` 主要负责报告表面，不自动生成分析结论或任意图表。
- 旧工作簿修改仍需通过真实公式、数据范围和重算状态验证。

### 4.8 Excel `format_sheet`

当前 `edit_spreadsheet` 支持 `format_sheet` 操作：

- 指定现有 `sheet`
- 提供 `presentation`

它让旧工作簿在不从头重建的前提下套用报告 title/header/body、网格线、打印和页面设置。范围必须真实、非空且互不重叠，不能为了视觉装饰选中无关空白区域。

### 4.9 Office 验证与渲染

当前 `office_document.verify` 支持：

- `render`
- `recalculate`
- `render_path`
- `output_path`
- `timeout_ms`

公开资料映射：

- 对应 ZCode Goal 的“以实据判定完成”。
- 对应 WorkBuddy 的“任务内查看产物并进行持续修改”。
- 结构有效、Excel 重算完成、PDF 导出成功和逐页视觉通过是不同证据。研究文档不把 `render:true` 自动等同于视觉质量通过。

## 5. 映射到当前 Skill references

当前内置 Skill 已采用“主文件给路由，reference 按需读取”的结构。

| Skill | 当前协议 | 对应研究结论 |
| --- | --- | --- |
| `work-word` | 主文件要求复杂报告先读取 `work-word/references/editorial-quality.md`；reference 覆盖读者、语气、去空话、表格、题注、callout 和最终编辑。 | 对应 WorkBuddy 的目标/对象/语气/结构，以及“继续按差异修改”。 |
| `work-presentations` | 主文件要求先读取 `work-presentations/references/story-and-layout.md`；reference 覆盖断言标题、演讲语气、preset、`slide.kind`、`metric_grid`、图表、比较、路线图和视觉审查。 | 对应 WorkBuddy 风格模板与设计精修公开模式，但采用原生 PPTX 和受控结构，不复制画布或模板。 |
| `work-spreadsheets` | 主文件要求报告工作簿读取 `work-spreadsheets/references/report-surfaces.md`；reference 覆盖输入/假设/计算/展示分层、`workbook.design`、sheet `presentation`、`format_sheet`、数字格式、表格和打印。 | 对应 WorkBuddy 数据分析实践的指标、周期、图表、结论和报告输出。 |
| `artifact-quality` | 主文件要求格式验收时读取 `artifact-quality/references/format-acceptance.md`；reference 把内容编辑、视觉编辑、Word、Excel、PowerPoint 和交付证据分开。 | 对应 ZCode Goal 的实据验收，以及 WorkBuddy 的产物查看与迭代修改。 |
| 其他 Code/Work Skills | 只在匹配上下文时加载；用户安装的 Skill 仅在启用且被选中时暴露元数据。 | 对应 ZCode/WorkBuddy 的渐进披露、按需正文和避免 Skill 元数据挤占上下文。 |

这些 reference 是原创规则，不是从竞品页面复制的提示词。

## 6. 可借鉴但必须原创实现的能力

### 6.1 生产 brief

在生成前明确：

- 读者及所需决定
- 必须保留的事实、单位、时间范围和未知项
- 语言和语气
- 文档、表格或演示的叙事顺序
- preset、density、accent 和每种页面/工作表语法
- 哪些内容使用原生文字、表格、图片、图表或指标卡

当前由 `resources/prompts/work.md` 和各 Skill reference 约束。只有在需要机器强制验证时才应扩展 schema，不能把提示中的建议伪装成已有字段。

### 6.2 结构先于装饰

- Word：先形成章节任务和证据，再决定表格、题注、callout 或分页。
- Excel：先定义数据粒度、输入/计算/输出层和公式身份，再应用 `presentation` 或 `format_sheet`。
- PowerPoint：先写标题链和每页证据，再选择 `slide.kind`、`metric_grid`、图表或 statement。

### 6.3 有限设计系统

当前四个 preset 已提供有限而一致的设计起点。使用原则应是：

- 一个主 accent
- 一个次级信号色
- 中性正文
- 一致的标题层级和栅格
- 只在含义变化时改变 tone
- 同一 deck 不逐页改变字体、背景和色彩逻辑

### 6.4 内容、语言、构图分开审

分别检查：

1. 事实、数字、单位和结论是否准确。
2. 语气是否符合读者，是否删除空洞形容词、重复结论和泛化口号。
3. 标题是否形成故事，表格和图表是否有必要，版式是否突出最重要的信息。
4. Office 包、公式、页码、打印区域和渲染是否真实通过。

## 7. 当前明确边界

- 不提供 Ardot 式自由画布或任意对象双向编辑。
- PPT 没有公开的完整品牌母版导入、SmartArt/OLE/动画保真编辑能力。
- PPT 视觉字段目前是受控组合，不是任意自由形状 DSL。
- Excel 当前没有完整的图表 DSL、条件格式 DSL、数据验证 DSL 或自动公式生成器。
- Workbook `presentation` 只处理报告表面和打印设置，不证明计算正确。
- 没有任何自动检查可以替代逐页视觉复核。
- 不复制 WorkBuddy、Ardot、ZCode 的模板、图标、品牌配色、截图或私有代码。

## 8. 后续研究问题

以下问题本轮没有公开证据，不能靠猜测补齐：

1. 两个产品是否对文档质量设定了可量化评分器。
2. WorkBuddy 的专家包是否允许第三方携带经授权的 PPT 模板和字体。
3. ZCode `document-skills` 在不同模型下是否使用相同排版规则。
4. 两套产品如何检测版式溢出、视觉重叠和页级节奏，哪些步骤依赖人工或图像模型。
5. 竞品是否保留完整的历史产物版本，以及回退语义是否覆盖所有 Office 对象。

在这些资料出现前，Mingshen Harness 应以自有 schema、可复现 fixture、真实渲染、明确未验证项和原创 skill 继续迭代。
