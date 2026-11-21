# 工作站模板指南

适用版本：1.3.4

## 模板目录

从主界面打开创作工作站。模板目录包含 **780 个原创工作场景**，按 65 种任务结构、每种 12 个场景组织；目录不是 780 份预先生成的 Office 文件。每个场景可以选择简略或详细提示词，目录总计提供 1,560 种场景与提示词组合。

模板按以下 12 类索引：

| 分类 | 常见用途 |
| --- | --- |
| 演示汇报 | 决策、经营回顾、客户沟通和项目汇报 |
| 文档方案 | 制度、说明、方案、复盘和正式报告 |
| 表格模型 | 预算、预测、核算、跟踪和数据看板 |
| 海报视觉 | 活动、通知、课程和信息传播素材 |
| 课程教学 | 教案、课程体系、培训、练习和评估 |
| 项目规划 | 启动、路线图、资源安排、风险和里程碑 |
| 研究分析 | 市场、用户、行业、证据和决策分析 |
| 品牌传播 | 发布、内容计划、活动和客户沟通 |
| 产品设计 | 需求、方案、体验和产品评审 |
| 技术工程 | 技术方案、系统设计、交付与工程复盘 |
| 组织人才 | 招聘、入职、绩效、岗位和团队发展 |
| 运营治理 | 流程、服务、合规检查、事故复盘和持续改进 |

实际交付格式筛选为 `PPTX`、`DOCX`、`XLSX`、`PDF` 和 `HTML`。目录可将关键词、分类和格式组合筛选；关键词会匹配模板名称、说明、标签、章节与章节意图、格式和推荐技能。结果按页显示，可继续载入更多匹配项。

Office 生态中的部分场景也用于 Outlook、OneNote、Teams、SharePoint、Forms、Visio、Project、Access 和 Power BI 的内容、规格或交接工作流。它们不代表应用能生成这些产品的全部原生格式：当前模板产物仅按可用工具制作成上述支持格式。模板不会自动发送邮件、创建云端内容或发布资料，也不保证生成 `.mpp`、`.vsdx`、`.accdb`、`.pbix` 等文件。旧版二进制 `.doc`、`.xls`、`.ppt` 不在当前交付格式范围内。

## 简略与详细

模板版本切换位于草稿编辑区：

- **简略**：沿用简洁的工作请求、章节、流程、验收和执行规则，适合先快速起草或由用户继续补足细节。没有提示词版本字段的旧草稿仍按简略版打开。
- **详细**：针对当前场景增加资料清单、字段和数据口径、专业处理步骤、交付结构、风险、格式要求及逐项检查；默认中文详细提示词不少于 **800 个汉字**，由场景专属内容与同类共享的专业流程、执行规则组成。字数不表示每项均独立撰写 800 字，也不保证编辑后的长度或交付质量，成品仍需实际验收。新选择的模板默认采用详细版。

两种版本均使用当前草稿内容。修改主题、受众、目的、资料、格式、风格、约束或章节后，完整提示词预览和复制结果会随之更新；详细版本还会根据当前分类和交付格式列出相关技能建议。切换版本不会覆盖草稿中的其他字段，支持撤销，并随草稿 JSON 导入导出。

## 推荐技能

技能建议会依据模板分类和当前交付格式生成，格式改变后也会相应调整。常用技能 ID 包括：

| 技能 ID | 适用方向 |
| --- | --- |
| `builtin:work-word` | DOCX 结构、样式、表格与分页 |
| `builtin:work-spreadsheets` | XLSX 数据类型、公式、表格结构与勾稽 |
| `builtin:work-presentations` | PPTX 叙事、页面组织与演示可读性 |
| `builtin:work-ppt-master` | PPTX 版式、可编辑内容与逐页复核 |
| `builtin:work-pdf` | PDF 页面、文本、链接和渲染检查 |
| `builtin:work-visual-design` | 海报与传播内容的视觉层级和网格 |
| `builtin:work-analysis` | 数据口径、指标和不确定性 |
| `builtin:work-research` | 来源、引用、反证与事实核验 |
| `builtin:work-operations` | 流程、角色、行动项和交接 |
| `builtin:artifact-quality` | 内容、可读性与实际验证状态 |

推荐表示当前场景可能需要该项能力，不表示技能已经加载、执行或得到授权。实际使用仍受 WorkAgent 会话、技能启用状态、当前权限和可用工具限制；不能因提示词中列出技能而绕过权限拒绝。缺少来源、数字、审批或实际检查时应保留为待确认或未验证，不得由模板补造。

同源同路径的内置来源技能只展示语义最新版，独立来源和用途变体分别保留。旧会话的手动引用对应到当前版本；针对旧ID的明确拒绝或审批规则继续约束同源最新版，包括取消引用再选中后，须在Agent配置中明确修改规则才能改变权限。选择模板或技能均不代表权限批准。

## 从模板到任务

1. 使用关键词、分类和格式缩小目录范围，查看模板摘要与右侧的章节、流程和验收标准。
2. 选择合适场景并确认替换草稿；替换后可撤销，也可先导出现有 JSON 草稿。
3. 在编辑区填写具体主题、受众、目的、现有资料、交付格式、风格和约束。按实际任务调整章节标题、备注与顺序；章节数量可在 1 至 30 项之间。
4. 在预览中核对当前简略版或详细版的完整提示词；需要时复制提示词，或使用“交给 WorkAgent 执行”。
5. 交接会把提示词加入 WorkAgent 输入框，不会自动发送，也不会仅因选择模板而创建文件。检查提示词及已有输入内容，再由用户主动发送任务。

草稿按工作区保存在本地。导入 JSON 前会校验模板、字段和章节，并要求确认替换；单个导入文件上限为 5 MiB。保存失败时请在刷新或退出前重试保存或导出。若草稿数据无法读取或格式无效，原始值不会被自动覆盖；请导出当前编辑内容后再离开。

## 示例

以下名称、格式和技能 ID 可直接在模板目录中检索：

| 模板 ID | 目录名称 | 格式 | 适用侧重点 | 主要技能建议 |
| --- | --- | --- | --- | --- |
| `financial-model--decision` | 财务模型 · 收入情景分析 | XLSX | 对比基准、乐观和保守收入假设，呈现现金需求并保留来源与公式检查 | `builtin:work-spreadsheets`、`builtin:work-analysis`、`builtin:work-operations`、`builtin:artifact-quality` |
| `lesson-plan--investor` | 单课教案 · 课堂练习课 | DOCX | 将课堂练习、活动时长和检查证据对应到学习目标 | `builtin:work-word`、`builtin:work-operations`、`builtin:artifact-quality` |
| `expense-reimbursement--executive` | 报销与差旅 · 差旅事前申请 | XLSX | 将拟订行程与差旅标准、预算余额及审批例外对应，避免把批准等同于预订或付款 | `builtin:work-spreadsheets`、`builtin:work-analysis`、`builtin:work-operations`、`builtin:artifact-quality` |

这些是模板目录提供的工作流起点，不是已经核实过的业务结论或现成文件。交付质量取决于用户提供的资料、实际工具执行和逐项验收；Office 重算或渲染不可用时，应如实标注未验证。

## English summary

The workstation contains 780 original work scenarios across 12 categories, with a brief and a detailed prompt for each. Search can combine keywords, category and supported output format (`PPTX`, `DOCX`, `XLSX`, `PDF` or `HTML`). Default Chinese detailed prompts contain at least 800 Han characters, combining scenario-specific inputs, methods and risks with shared workflows and execution rules. This count is not 800 independently authored characters per scenario, a guarantee after edits or a substitute for deliverable acceptance. Suggested built-in skills are recommendations, not proof that they were loaded or authorized. Handing a prompt to WorkAgent adds it to the composer but does not send it or create a file; review it and send the task explicitly. Templates do not promise unsupported native Office formats or automatic email/cloud publishing.
