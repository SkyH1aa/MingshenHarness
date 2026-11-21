import type { CreativeExtendedFamily, CreativeTranslation } from "./creative-template-authoring";
import { EXTENDED_CREATIVE_FAMILIES_A } from "./creative-template-families-a";
import { EXTENDED_CREATIVE_FAMILIES_B } from "./creative-template-families-b";
import { EXTENDED_CREATIVE_FAMILIES_C } from "./creative-template-families-c";
import { LEGACY_DETAILED_CASES_A } from "./creative-template-legacy-details-a";
import { LEGACY_DETAILED_CASES_B } from "./creative-template-legacy-details-b";
import { LEGACY_DETAILED_CASES_C } from "./creative-template-legacy-details-c";
import { LEGACY_CREATIVE_PLAYBOOKS } from "./creative-template-legacy-playbooks";
import { CREATIVE_FAMILY_SCENARIOS } from "./creative-template-scenarios";

export type CreativeTemplateCategory =
  | "presentation"
  | "document"
  | "spreadsheet"
  | "poster"
  | "learning"
  | "planning"
  | "research"
  | "marketing"
  | "product"
  | "engineering"
  | "people"
  | "operations";

export type CreativeTemplateFormat = "PPTX" | "DOCX" | "XLSX" | "PDF" | "HTML";

export interface CreativeTemplateSection {
  id: string;
  title: string;
  titleEn: string;
  intent: string;
  intentEn: string;
}

export interface CreativeRecommendedSkill {
  id: string;
  name: string;
  nameEn: string;
  reason: string;
  reasonEn: string;
}

interface CreativeDetailedPlan {
  focus: LocalizedText;
  inputs: LocalizedText;
  output: LocalizedText;
  risk: LocalizedText;
  playbook?: {
    inputs: LocalizedText;
    method: LocalizedText;
    design: LocalizedText;
    checks: LocalizedText;
  };
}

export interface CreativeTemplate {
  id: string;
  familyId: string;
  variantId: string;
  name: string;
  nameEn: string;
  category: CreativeTemplateCategory;
  format: CreativeTemplateFormat;
  summary: string;
  summaryEn: string;
  detailedDescription: string;
  detailedDescriptionEn: string;
  recommendedSkills: CreativeRecommendedSkill[];
  detailedPlan: CreativeDetailedPlan;
  defaultAudience: string;
  defaultAudienceEn: string;
  sections: CreativeTemplateSection[];
  acceptance: string[];
  acceptanceEn: string[];
  workflow: string[];
  workflowEn: string[];
  tags: string[];
}

export interface CreativeDraftSection {
  id: string;
  title: string;
  notes: string;
}

export interface CreativeWorkspaceDraft {
  version: 1;
  promptMode?: "brief" | "detailed";
  templateId: string;
  title: string;
  subject: string;
  audience: string;
  purpose: string;
  sourceMaterials: string;
  deliverable: string;
  style: string;
  constraints: string;
  sections: CreativeDraftSection[];
  updatedAt: string;
}

interface LocalizedText {
  zh: string;
  en: string;
}

interface SectionDefinition {
  id: string;
  title: LocalizedText;
  intent: LocalizedText;
}

interface FamilyDefinition {
  id: string;
  name: LocalizedText;
  category: CreativeTemplateCategory;
  format: CreativeTemplateFormat;
  summary: LocalizedText;
  sections: SectionDefinition[];
  acceptance: LocalizedText[];
  workflow: LocalizedText[];
  defaultStyle: LocalizedText;
}

interface VariantDefinition {
  id: string;
  name: LocalizedText;
  audience: LocalizedText;
  section: SectionDefinition;
  acceptance: LocalizedText[];
}

const t = (zh: string, en: string): LocalizedText => ({ zh, en });
const s = (
  id: string,
  zh: string,
  en: string,
  intentZh: string,
  intentEn: string,
): SectionDefinition => ({
  id,
  title: t(zh, en),
  intent: t(intentZh, intentEn),
});

export const CREATIVE_TEMPLATE_CATEGORIES: ReadonlyArray<{
  id: CreativeTemplateCategory;
  label: string;
  labelEn: string;
}> = [
  { id: "presentation", label: "演示汇报", labelEn: "Presentations" },
  { id: "document", label: "文档方案", labelEn: "Documents" },
  { id: "spreadsheet", label: "表格模型", labelEn: "Spreadsheets" },
  { id: "poster", label: "海报视觉", labelEn: "Posters" },
  { id: "learning", label: "课程教学", labelEn: "Learning" },
  { id: "planning", label: "项目规划", labelEn: "Planning" },
  { id: "research", label: "研究分析", labelEn: "Research" },
  { id: "marketing", label: "品牌传播", labelEn: "Marketing" },
  { id: "product", label: "产品设计", labelEn: "Product" },
  { id: "engineering", label: "技术工程", labelEn: "Engineering" },
  { id: "people", label: "组织人才", labelEn: "People" },
  { id: "operations", label: "运营治理", labelEn: "Operations" },
];

const FAMILIES: ReadonlyArray<FamilyDefinition> = [
  {
    id: "decision-deck",
    name: t("决策汇报", "Decision briefing"),
    category: "presentation",
    format: "PPTX",
    summary: t(
      "围绕一个明确决策组织事实、选项、风险与建议",
      "Organize facts, options, risks, and a recommendation around one decision",
    ),
    sections: [
      s(
        "decision",
        "决策与建议",
        "Decision and recommendation",
        "首页直接给出要决定的事项、建议和影响",
        "State the decision, recommendation, and impact up front",
      ),
      s(
        "context",
        "背景与目标",
        "Context and objective",
        "解释为什么现在需要决定，并定义成功标准",
        "Explain why a decision is needed now and define success",
      ),
      s(
        "evidence",
        "关键事实",
        "Key evidence",
        "用数据、用户证据和约束支持判断，区分事实与假设",
        "Support judgment with data, user evidence, and constraints",
      ),
      s(
        "options",
        "选项对比",
        "Option comparison",
        "比较至少三个方案的价值、成本、风险和可逆性",
        "Compare at least three options by value, cost, risk, and reversibility",
      ),
      s(
        "recommendation",
        "推荐路径",
        "Recommended path",
        "给出判断理由、前置条件和等待成本",
        "Give the rationale, prerequisites, and cost of delay",
      ),
      s(
        "risks",
        "风险与保障",
        "Risks and safeguards",
        "列出主要风险、触发条件和责任",
        "List material risks, triggers, and owners",
      ),
      s(
        "appendix",
        "支撑附录",
        "Supporting appendix",
        "保留数据口径、来源和计算过程",
        "Retain data definitions, sources, and calculations",
      ),
    ],
    acceptance: [
      t("每页标题表达一个结论", "Every slide title states a conclusion"),
      t(
        "建议与证据一一对应，无来源数字不出现",
        "Recommendations map to evidence with no unsourced figures",
      ),
      t(
        "包含不作为的代价和清晰决策请求",
        "Include the cost of inaction and a clear decision request",
      ),
    ],
    workflow: [
      t("先确定唯一决策问题", "Define the single decision first"),
      t("区分事实、解释和判断", "Separate facts, interpretation, and judgment"),
      t("对建议做反方审查", "Stress-test the recommendation"),
      t(
        "生成后检查溢出、间距和投影可读性",
        "Inspect overflow, spacing, and projection readability",
      ),
    ],
    defaultStyle: t("克制、清晰、数据驱动", "Restrained, clear, evidence-led"),
  },
  {
    id: "company-narrative",
    name: t("公司故事", "Company narrative"),
    category: "presentation",
    format: "PPTX",
    summary: t(
      "用一致叙事说明愿景、问题、产品价值和增长逻辑",
      "Build a coherent story around vision, problem, value, and growth",
    ),
    sections: [
      s(
        "hook",
        "开场钩子",
        "Opening hook",
        "用真实矛盾或变化抓住注意力",
        "Open with a real tension or change",
      ),
      s(
        "problem",
        "问题与代价",
        "Problem and cost",
        "说明谁受影响、损失是什么、现有方案为何不足",
        "Show who is affected, the loss, and why alternatives fall short",
      ),
      s(
        "insight",
        "核心洞察",
        "Core insight",
        "提出改变判断的关键洞察及证据",
        "Present the insight that changes the decision",
      ),
      s(
        "solution",
        "解决方案",
        "Solution",
        "说明产品、服务或方法如何产生结果",
        "Explain how the solution creates the outcome",
      ),
      s(
        "proof",
        "价值证明",
        "Proof of value",
        "用案例、数据、演示或里程碑证明可行性",
        "Prove viability with cases, data, demos, or milestones",
      ),
      s(
        "business",
        "增长逻辑",
        "Growth logic",
        "连接用户价值、市场路径和可持续模式",
        "Connect user value, market path, and a sustainable model",
      ),
      s(
        "ask",
        "行动请求",
        "Call to action",
        "明确下一步、所需支持与时间窗口",
        "Specify next steps, support, and timing",
      ),
    ],
    acceptance: [
      t("整份演示只有一条主线", "The deck follows one narrative line"),
      t("主张有案例或数据支撑", "Claims have case or data support"),
      t("最后三页回到明确行动", "The final pages return to a concrete action"),
    ],
    workflow: [
      t("先写一页叙事摘要", "Draft a one-page narrative first"),
      t("逐页检查因果关系", "Check causal links between pages"),
      t("删除重复概念和装饰性图表", "Remove duplicate concepts and ornamental charts"),
      t("使用真实产品状态并完成渲染复核", "Use actual product states and render-check the deck"),
    ],
    defaultStyle: t("有张力、可信、少即是多", "Editorial, credible, and concise"),
  },
  {
    id: "product-launch",
    name: t("产品发布", "Product launch"),
    category: "marketing",
    format: "PPTX",
    summary: t(
      "说明新品、用户价值、发布节奏和上线准备",
      "Explain a new product, user value, launch cadence, and readiness",
    ),
    sections: [
      s(
        "promise",
        "发布承诺",
        "Launch promise",
        "用一句话说明发布后用户得到什么",
        "State the user outcome in one sentence",
      ),
      s(
        "audience",
        "用户与场景",
        "Audience and scenarios",
        "区分首要用户、次要用户与关键使用时刻",
        "Distinguish primary user moments from secondary ones",
      ),
      s(
        "experience",
        "体验与差异",
        "Experience and difference",
        "展示完整任务链和真实差异",
        "Show the full job flow and real differentiation",
      ),
      s(
        "readiness",
        "上线就绪度",
        "Launch readiness",
        "覆盖产品、支持、合规、运营和回退",
        "Cover product, support, compliance, operations, and rollback",
      ),
      s(
        "gtm",
        "发布节奏",
        "Go-to-market cadence",
        "安排预热、首发、扩散和持续运营",
        "Sequence preview, launch, amplification, and operation",
      ),
      s(
        "metrics",
        "指标与观察窗",
        "Metrics and observation",
        "定义采用、质量、支持和商业指标",
        "Define adoption, quality, support, and business metrics",
      ),
      s(
        "guardrails",
        "发布保障",
        "Launch safeguards",
        "列出阻塞项、值守安排和停止条件",
        "List blockers, on-call ownership, and stop conditions",
      ),
    ],
    acceptance: [
      t("发布承诺可从用户视角验证", "The promise is verifiable from the user view"),
      t("就绪度明确区分已完成与待完成", "Readiness separates completed and pending work"),
      t("包含回退与停止条件", "Include rollback and stop conditions"),
    ],
    workflow: [
      t("从用户任务而非功能列表组织故事", "Structure the story around user jobs"),
      t("核对发布依赖和责任人", "Verify dependencies and owners"),
      t("使用真实产品界面或状态", "Use real interface states"),
      t("生成并检查关键页面可读性", "Render and inspect key slides"),
    ],
    defaultStyle: t("产品化、现代、真实界面优先", "Product-led, modern, interface-first"),
  },
  {
    id: "training-deck",
    name: t("培训课件", "Training deck"),
    category: "learning",
    format: "PPTX",
    summary: t(
      "从学习目标、练习和迁移任务组织可授课培训",
      "Build a teachable session around outcomes, practice, and transfer",
    ),
    sections: [
      s(
        "outcomes",
        "学习目标",
        "Learning outcomes",
        "用可观察行为描述学员完成后能做什么",
        "Describe observable post-session behavior",
      ),
      s(
        "baseline",
        "起点与障碍",
        "Starting point",
        "识别已有知识、误区和学习阻力",
        "Identify prior knowledge, misconceptions, and barriers",
      ),
      s(
        "concepts",
        "核心概念",
        "Core concepts",
        "用例子和反例解释最少量的关键概念",
        "Explain essential concepts with examples and counterexamples",
      ),
      s(
        "demo",
        "示范拆解",
        "Demonstration",
        "完整演示一次任务并标出判断点",
        "Demonstrate the task and mark decision points",
      ),
      s(
        "practice",
        "引导练习",
        "Guided practice",
        "提供分层练习、提示和即时反馈",
        "Provide tiered practice, hints, and feedback",
      ),
      s(
        "transfer",
        "迁移任务",
        "Transfer task",
        "让学员在变化情境中独立应用",
        "Ask learners to apply the skill in a changed context",
      ),
      s(
        "assessment",
        "评估与复盘",
        "Assessment",
        "定义达标证据和课后复盘方式",
        "Define evidence of mastery and reflection",
      ),
    ],
    acceptance: [
      t("学习目标可观察、可评估", "Learning outcomes are observable and assessable"),
      t("讲授不超过总时长一半", "Lecture uses no more than half the time"),
      t("练习包含提示、答案和反馈标准", "Practice includes hints, answers, and feedback criteria"),
    ],
    workflow: [
      t("先对齐目标、活动和评估", "Align objectives, activities, and assessment"),
      t("控制单页认知负荷", "Control per-slide cognitive load"),
      t("为不同基础准备补充材料", "Prepare support for varied starting levels"),
      t("检查讲师备注、字号和练习页", "Check notes, type size, and practice pages"),
    ],
    defaultStyle: t("教学友好、节奏清晰、高对比", "Instructional, paced, high-contrast"),
  },
  {
    id: "project-kickoff",
    name: t("项目启动", "Project kickoff"),
    category: "planning",
    format: "PPTX",
    summary: t(
      "统一项目目标、范围、角色、里程碑和协作规则",
      "Align goals, scope, roles, milestones, and working rules",
    ),
    sections: [
      s(
        "mandate",
        "项目使命",
        "Project mandate",
        "说明为何启动、由谁授权和成功定义",
        "State why, who authorized it, and what success means",
      ),
      s(
        "scope",
        "范围边界",
        "Scope boundaries",
        "列出包含、不包含和待确认事项",
        "List included, excluded, and unresolved scope",
      ),
      s(
        "workstreams",
        "工作流与成果",
        "Workstreams",
        "按结果组织工作流并定义验收物",
        "Organize workstreams by outcome",
      ),
      s(
        "roles",
        "角色与决策权",
        "Roles and decisions",
        "区分负责、审批、咨询和知会角色",
        "Distinguish responsible, approving, consulted, and informed roles",
      ),
      s(
        "milestones",
        "里程碑",
        "Milestones",
        "明确阶段结果、日期和依赖",
        "Specify outcomes, dates, and dependencies",
      ),
      s(
        "risks",
        "风险与假设",
        "Risks and assumptions",
        "记录关键假设、触发条件和缓解责任",
        "Record assumptions, triggers, and mitigation owners",
      ),
      s(
        "cadence",
        "协作节奏",
        "Operating cadence",
        "约定会议、状态更新、升级和文档位置",
        "Agree on meetings, updates, escalation, and documentation",
      ),
    ],
    acceptance: [
      t("每项范围都有纳入或排除判断", "Every scope item is included or excluded"),
      t("角色名称与真实责任人一致", "Roles map to real accountable people"),
      t("里程碑具备完成定义", "Milestones have definitions of done"),
    ],
    workflow: [
      t("先建立成果树，再分配工作流", "Build the outcome tree before workstreams"),
      t("识别跨团队依赖和单点风险", "Identify cross-team dependencies and single points"),
      t("为关键决定写明决策人", "Name decision owners"),
      t("检查路线图与角色图的清晰度", "Inspect roadmap and role map clarity"),
    ],
    defaultStyle: t("结构化、协作导向、状态明确", "Structured, collaborative, status-forward"),
  },
  {
    id: "client-proposal",
    name: t("客户提案", "Client proposal"),
    category: "presentation",
    format: "PPTX",
    summary: t(
      "从客户问题、方案、价值、证据和商业条款完成提案",
      "Address client problem, solution, value, proof, and commercial terms",
    ),
    sections: [
      s(
        "understanding",
        "问题理解",
        "Problem understanding",
        "复述客户目标、限制和决策背景",
        "Restate goals, constraints, and decision context",
      ),
      s(
        "opportunity",
        "机会定义",
        "Opportunity",
        "量化机会或风险并定义本次工作边界",
        "Quantify opportunity or risk and define the engagement",
      ),
      s(
        "approach",
        "解决路径",
        "Approach",
        "把工作拆成客户可理解的阶段和产出",
        "Split work into understandable stages and outputs",
      ),
      s(
        "value",
        "预期价值",
        "Expected value",
        "说明业务结果、衡量方式和实现条件",
        "Explain outcomes, measurement, and prerequisites",
      ),
      s(
        "proof",
        "信任证据",
        "Proof",
        "提供案例、样张、团队经验或验证方法",
        "Provide cases, samples, experience, or validation",
      ),
      s(
        "delivery",
        "交付计划",
        "Delivery plan",
        "列出里程碑、接口、风险和治理",
        "List milestones, interfaces, risks, and governance",
      ),
      s(
        "commercial",
        "商业条款",
        "Commercial terms",
        "明确范围、费用结构、假设和变更机制",
        "Specify scope, pricing, assumptions, and change control",
      ),
    ],
    acceptance: [
      t("客户能从首页看懂问题和价值", "Clients understand problem and value from page one"),
      t("方案范围与商业条款一致", "Solution scope and commercial terms align"),
      t("没有未经确认的承诺或案例", "No unconfirmed promises or cases"),
    ],
    workflow: [
      t("先提炼客户决策标准", "Extract client decision criteria"),
      t("将能力映射到客户结果", "Map capabilities to client outcomes"),
      t("补全假设、排除项和验收方式", "Complete assumptions, exclusions, and acceptance"),
      t("生成并检查提案的专业度与页码", "Render-check professionalism and pagination"),
    ],
    defaultStyle: t("可信、定制、商业清晰", "Credible, tailored, commercially clear"),
  },
  {
    id: "strategy-brief",
    name: t("战略简报", "Strategy brief"),
    category: "document",
    format: "DOCX",
    summary: t(
      "把环境判断、战略选择、行动和衡量统一成决策文档",
      "Unify environmental judgment, strategic choice, action, and measurement",
    ),
    sections: [
      s(
        "summary",
        "战略摘要",
        "Strategy summary",
        "一页说明判断、选择和预期变化",
        "State the judgment, choice, and expected change in one page",
      ),
      s(
        "environment",
        "环境变化",
        "Environment",
        "整理趋势、客户、竞争和能力事实",
        "Synthesize trends, customers, competition, and capability",
      ),
      s(
        "choice",
        "战略选择",
        "Strategic choice",
        "明确取舍、边界和放弃事项",
        "State tradeoffs, boundaries, and what is abandoned",
      ),
      s(
        "advantages",
        "优势系统",
        "Advantage system",
        "说明能力组合如何形成可持续优势",
        "Explain how capabilities reinforce an advantage",
      ),
      s(
        "roadmap",
        "行动路线",
        "Action roadmap",
        "按时间安排关键动作和资源",
        "Sequence actions and resources",
      ),
      s(
        "metrics",
        "衡量与复盘",
        "Measurement",
        "定义先行指标、结果指标和复盘节奏",
        "Define leading and outcome metrics with review cadence",
      ),
      s(
        "risks",
        "风险与反证",
        "Risks and disconfirmers",
        "记录反方观点、触发信号和调整条件",
        "Record counterarguments, signals, and pivot conditions",
      ),
    ],
    acceptance: [
      t("明确写出取舍而非堆叠目标", "State tradeoffs instead of stacking goals"),
      t("战略选择与资源计划一致", "Strategic choice aligns with resourcing"),
      t("包含可触发的调整信号", "Include trigger conditions for adjustment"),
    ],
    workflow: [
      t("从变化而非口号开始", "Start from change rather than slogans"),
      t("做反方材料审查", "Review contrary evidence"),
      t("将策略翻译成季度行动", "Translate strategy into quarterly action"),
      t("检查 DOCX 层级、表格与页眉页脚", "Check DOCX hierarchy, tables, and headers"),
    ],
    defaultStyle: t("高层摘要、证据充分、取舍明确", "Executive, evidenced, and decisive"),
  },
  {
    id: "project-charter",
    name: t("项目章程", "Project charter"),
    category: "planning",
    format: "DOCX",
    summary: t(
      "以授权文档确定项目目标、范围、治理和验收",
      "Authorize a project through objectives, scope, governance, and acceptance",
    ),
    sections: [
      s(
        "authorization",
        "授权信息",
        "Authorization",
        "写明发起人、项目经理和生效条件",
        "State sponsor, project lead, and activation conditions",
      ),
      s(
        "outcomes",
        "目标与成果",
        "Outcomes",
        "定义业务目标、项目交付物和非目标",
        "Define business goals, deliverables, and non-goals",
      ),
      s(
        "scope",
        "范围与排除",
        "Scope",
        "区分必须交付、可选和明确排除",
        "Separate required, optional, and excluded work",
      ),
      s(
        "governance",
        "治理机制",
        "Governance",
        "约定决策会、升级路径和文档控制",
        "Set decision forums, escalation, and document control",
      ),
      s(
        "plan",
        "总体计划",
        "Delivery plan",
        "列出阶段、里程碑、依赖和资源",
        "List phases, milestones, dependencies, and resources",
      ),
      s(
        "acceptance",
        "验收标准",
        "Acceptance",
        "定义完成证据、签署角色和移交",
        "Define evidence, sign-off roles, and handover",
      ),
      s(
        "constraints",
        "约束与假设",
        "Constraints",
        "记录预算、法规、技术和外部条件",
        "Record budget, legal, technical, and external conditions",
      ),
    ],
    acceptance: [
      t("发起人和项目经理职责明确", "Sponsor and project lead accountabilities are clear"),
      t("范围排除项可审计", "Scope exclusions are auditable"),
      t("验收标准可测试", "Acceptance criteria are testable"),
    ],
    workflow: [
      t("先写完成定义，再写活动", "Define done before activities"),
      t("检查权限与资源承诺", "Check authority and resource commitments"),
      t("把假设转为验证任务", "Turn assumptions into validation tasks"),
      t("检查字段、签署区和版本历史", "Check fields, sign-off, and version history"),
    ],
    defaultStyle: t("正式、可授权、条款清楚", "Formal, authorizable, and precise"),
  },
  {
    id: "policy-playbook",
    name: t("政策手册", "Policy playbook"),
    category: "operations",
    format: "DOCX",
    summary: t(
      "把规则、角色、流程、例外和证据组织成可执行制度",
      "Turn rules, roles, process, exceptions, and evidence into an executable policy",
    ),
    sections: [
      s(
        "purpose",
        "目的与适用",
        "Purpose and applicability",
        "定义适用对象、场景和制度目标",
        "Define scope, audience, and policy objective",
      ),
      s(
        "principles",
        "政策原则",
        "Policy principles",
        "列出不可妥协原则和解释优先级",
        "List non-negotiable principles and precedence",
      ),
      s(
        "rules",
        "具体要求",
        "Requirements",
        "使用必须、应该、可以区分强制等级",
        "Use must, should, and may for obligation levels",
      ),
      s(
        "roles",
        "角色与责任",
        "Roles",
        "明确所有者、执行者、审批者和审计者",
        "Name owners, operators, approvers, and auditors",
      ),
      s(
        "process",
        "执行流程",
        "Process",
        "绘制正常流程、检查点和记录",
        "Describe normal flow, controls, and records",
      ),
      s(
        "exceptions",
        "例外处理",
        "Exceptions",
        "定义例外条件、审批、期限和复盘",
        "Define exception criteria, approval, duration, and review",
      ),
      s(
        "evidence",
        "证据与违规",
        "Evidence and violations",
        "列出可审计证据、后果和整改路径",
        "List auditable evidence, consequences, and remediation",
      ),
    ],
    acceptance: [
      t("每条要求都有执行角色", "Every requirement has an operator"),
      t("例外不会绕过审计记录", "Exceptions cannot bypass audit records"),
      t("术语和强制等级全篇一致", "Terms and obligation levels stay consistent"),
    ],
    workflow: [
      t("从风险和控制目标推导规则", "Derive rules from risk and control objectives"),
      t("用真实流程走查责任边界", "Walk through real workflows and responsibility boundaries"),
      t("检查例外、保留期和证据字段", "Check exceptions, retention, and evidence fields"),
      t("生成 DOCX 并核对编号与交叉引用", "Check DOCX numbering and cross-references"),
    ],
    defaultStyle: t("正式、无歧义、可审计", "Formal, unambiguous, auditable"),
  },
  {
    id: "sop",
    name: t("标准作业程序", "Standard operating procedure"),
    category: "operations",
    format: "DOCX",
    summary: t(
      "把一项重复工作写成可培训、可检查、可恢复的标准流程",
      "Document a repeatable operation with training, checks, and recovery",
    ),
    sections: [
      s(
        "scope",
        "适用范围",
        "Scope",
        "定义流程开始、结束和已知边界",
        "Define start, finish, and known boundaries",
      ),
      s(
        "prerequisites",
        "准备与权限",
        "Prerequisites",
        "列出工具、权限、输入和角色分工",
        "List tools, access, inputs, and roles",
      ),
      s(
        "steps",
        "操作步骤",
        "Steps",
        "按动作、判断和输出编写可执行步骤",
        "Write steps by action, decision, and output",
      ),
      s(
        "checks",
        "质量检查",
        "Quality checks",
        "设置关键检查点、容差和签字",
        "Set checkpoints, tolerances, and sign-off",
      ),
      s(
        "recovery",
        "异常恢复",
        "Recovery",
        "说明常见失败、回退和安全处置",
        "Describe common failures, rollback, and safe handling",
      ),
      s(
        "records",
        "记录与移交",
        "Records and handover",
        "定义必须保留的证据和交接信息",
        "Define retained evidence and handover",
      ),
      s(
        "revision",
        "版本与演练",
        "Revision and rehearsal",
        "安排复审、演练和变更记录",
        "Schedule review, rehearsal, and change history",
      ),
    ],
    acceptance: [
      t(
        "新执行者按文档可完成主流程",
        "A new operator can complete the main flow from the document",
      ),
      t("每一步有明确输出或判断", "Every step has an output or decision"),
      t("异常恢复包含安全停止条件", "Recovery includes a safe stop condition"),
    ],
    workflow: [
      t("观察或还原真实执行步骤", "Observe or reconstruct actual execution"),
      t("把隐含经验转为检查点", "Turn tacit knowledge into checkpoints"),
      t("做失败模式走查", "Walk through failure modes"),
      t("用任务列表和表格组织 DOCX", "Use checklists and tables in DOCX"),
    ],
    defaultStyle: t("操作导向、短句、检查表优先", "Operational, concise, checklist-led"),
  },
  {
    id: "research-report",
    name: t("研究报告", "Research report"),
    category: "research",
    format: "DOCX",
    summary: t(
      "从问题、方法、证据、发现和局限形成可信研究结论",
      "Build credible findings from question, method, evidence, and limitations",
    ),
    sections: [
      s(
        "question",
        "研究问题",
        "Research question",
        "定义问题边界、对象和决策用途",
        "Define scope, subjects, and decision use",
      ),
      s(
        "method",
        "方法与数据",
        "Method and data",
        "说明样本、来源、步骤和质量控制",
        "Explain sample, sources, process, and quality controls",
      ),
      s(
        "findings",
        "主要发现",
        "Findings",
        "按证据强度呈现发现，不把相关性当因果",
        "Present findings by evidence strength",
      ),
      s(
        "interpretation",
        "解释与含义",
        "Interpretation",
        "讨论结果对目标受众意味着什么",
        "Explain implications for the intended audience",
      ),
      s(
        "comparison",
        "对照与反证",
        "Comparison and counterevidence",
        "比较其他解释、来源和竞争假设",
        "Compare alternative explanations and sources",
      ),
      s(
        "limitations",
        "局限",
        "Limitations",
        "明确样本、方法、时间和外推限制",
        "State sample, method, timing, and transfer limits",
      ),
      s(
        "sources",
        "来源与附录",
        "Sources and appendix",
        "保留可核验来源、字段说明和详细数据",
        "Retain verifiable sources, definitions, and detailed data",
      ),
    ],
    acceptance: [
      t("结论强度不超过证据", "Conclusions do not exceed evidence"),
      t("方法与数据口径可复核", "Method and data definitions are reviewable"),
      t("主要反证得到回应", "Counterevidence is addressed"),
    ],
    workflow: [
      t("先登记来源和资料质量", "Register sources and quality first"),
      t("建立发现—证据—含义对应表", "Map findings to evidence and implications"),
      t("主动寻找反證和替代解释", "Search for counterevidence and alternatives"),
      t("检查 DOCX 图表、脚注和来源列表", "Check DOCX figures, footnotes, and references"),
    ],
    defaultStyle: t("学术严谨、克制、来源可追溯", "Rigorous, restrained, traceable"),
  },
  {
    id: "technical-evaluation",
    name: t("技术评估", "Technical evaluation"),
    category: "engineering",
    format: "DOCX",
    summary: t(
      "用可复现标准比较技术方案、性能和运行风险",
      "Compare technical options, performance, and operational risk with reproducible criteria",
    ),
    sections: [
      s(
        "problem",
        "问题与约束",
        "Problem and constraints",
        "定义必须解决的技术问题和不可违背条件",
        "Define the technical problem and hard constraints",
      ),
      s(
        "criteria",
        "评估标准",
        "Criteria",
        "给出权重、评分证据和淘汰门槛",
        "Define weights, evidence, and elimination thresholds",
      ),
      s(
        "options",
        "候选方案",
        "Options",
        "描述每个方案的架构、成本和适配性",
        "Describe architecture, cost, and fit for each option",
      ),
      s(
        "benchmark",
        "验证结果",
        "Benchmark",
        "记录测试环境、方法、原始指标和失败",
        "Record environments, methods, raw metrics, and failures",
      ),
      s(
        "operations",
        "运维与安全",
        "Operations and security",
        "评估可观测性、权限、故障和升级",
        "Assess observability, access, failure, and upgrades",
      ),
      s(
        "recommendation",
        "推荐与迁移",
        "Recommendation and migration",
        "给出选择理由、迁移步骤和回退",
        "Give rationale, migration steps, and rollback",
      ),
      s(
        "appendix",
        "复现附录",
        "Reproduction appendix",
        "保留配置、脚本、版本和原始日志",
        "Retain configuration, scripts, versions, and logs",
      ),
    ],
    acceptance: [
      t("淘汰标准先于结果定义", "Elimination criteria are defined before results"),
      t("性能数字带环境和测试方法", "Performance figures include environment and method"),
      t("推荐包含迁移和回退", "Recommendation includes migration and rollback"),
    ],
    workflow: [
      t("先固定约束和评分规则", "Fix constraints and scoring first"),
      t("在真实或等价环境验证", "Validate in a real or equivalent environment"),
      t("保留失败与异常，不只报均值", "Preserve failures and outliers"),
      t("检查 DOCX 表格、代码块和附录", "Check DOCX tables, code, and appendix"),
    ],
    defaultStyle: t("工程化、可复现、风险透明", "Engineering-led, reproducible, risk-transparent"),
  },
  {
    id: "meeting-brief",
    name: t("会议纪要", "Meeting brief"),
    category: "operations",
    format: "DOCX",
    summary: t(
      "把讨论、决定、行动、责任和后续检查组织成可追踪记录",
      "Turn discussion, decisions, actions, ownership, and follow-up into a traceable record",
    ),
    sections: [
      s(
        "meeting-purpose",
        "会议目的",
        "Meeting purpose",
        "说明会议要解决的问题、参与者和决策权限",
        "State the issue, participants, and decision authority",
      ),
      s(
        "key-discussion",
        "关键讨论",
        "Key discussion",
        "保留影响结论的论点、分歧和新增事实",
        "Retain arguments, disagreements, and new facts that shaped the outcome",
      ),
      s(
        "decisions",
        "已定决定",
        "Decisions",
        "区分已决定、待确认和未讨论事项",
        "Separate decided, pending, and undiscussed items",
      ),
      s(
        "actions",
        "行动项",
        "Actions",
        "每项写清动作、负责人、截止日期和完成定义",
        "Give every action an owner, due date, and definition of done",
      ),
      s(
        "risks",
        "风险与依赖",
        "Risks and dependencies",
        "记录阻塞、升级路径和需要的外部决定",
        "Record blockers, escalation paths, and external decisions",
      ),
      s(
        "follow-up",
        "后续检查",
        "Follow-up",
        "安排复盘时点、状态更新方式和存档位置",
        "Set review timing, status updates, and record location",
      ),
    ],
    acceptance: [
      t("每个决定能追溯到讨论依据", "Every decision traces to discussion evidence"),
      t("行动项没有模糊负责人或无日期事项", "Actions have explicit owners and dates"),
      t("待决事项与已定事项不会混淆", "Pending and decided items cannot be confused"),
    ],
    workflow: [
      t("先整理事实和真正的分歧", "Separate facts from genuine disagreement"),
      t("把决定写成可验证陈述", "Write decisions as verifiable statements"),
      t("逐项核对负责人、日期和依赖", "Check every owner, date, and dependency"),
      t("检查 DOCX 编号、表格和交叉引用", "Check DOCX numbering, tables, and references"),
    ],
    defaultStyle: t("简洁、结论优先、可追踪", "Concise, decision-first, traceable"),
  },
  {
    id: "brand-campaign",
    name: t("品牌战役", "Brand campaign"),
    category: "marketing",
    format: "HTML",
    summary: t(
      "从品牌张力、核心创意到渠道内容和衡量形成整合战役",
      "Build an integrated campaign from brand tension and creative idea through channels and measurement",
    ),
    sections: [
      s(
        "brand-tension",
        "品牌张力",
        "Brand tension",
        "指出受众真实矛盾与品牌可提供的独特转变",
        "Name the audience tension and the distinct change the brand can create",
      ),
      s(
        "campaign-audience",
        "受众洞察",
        "Audience insight",
        "区分核心受众、触发场景和行为障碍",
        "Distinguish core audiences, trigger moments, and behavioral barriers",
      ),
      s(
        "big-idea",
        "核心创意",
        "Creative idea",
        "用一句话提出可延展、可被记住的创意机制",
        "State one memorable, extensible creative mechanism",
      ),
      s(
        "message-system",
        "信息屋",
        "Message system",
        "建立主信息、证据支柱和不同受众的表达层",
        "Build a master message, proof pillars, and audience-specific layers",
      ),
      s(
        "channel-plan",
        "渠道编排",
        "Channel choreography",
        "按受众旅程安排渠道角色、内容与节奏",
        "Sequence channel roles, content, and cadence across the journey",
      ),
      s(
        "creative-system",
        "视觉与语言",
        "Creative system",
        "定义视觉、语气、素材规则和禁用模式",
        "Define visuals, tone, asset rules, and prohibited patterns",
      ),
      s(
        "measurement",
        "衡量与学习",
        "Measurement",
        "连接传播、行为和品牌指标及验证方式",
        "Connect communication, behavior, and brand metrics",
      ),
    ],
    acceptance: [
      t(
        "核心创意能覆盖全部渠道而不依赖重复口号",
        "The idea extends across channels without repeating a slogan",
      ),
      t("每条信息都有证据或明确表达边界", "Every message has proof or an explicit claim boundary"),
      t(
        "视觉与文案规则能交给真实设计执行",
        "Visual and copy rules are executable by a design team",
      ),
    ],
    workflow: [
      t("先做受众张力与品牌证据审查", "Review audience tension and brand evidence first"),
      t("从一个创意机制派生渠道内容", "Derive channel content from one creative mechanism"),
      t("检查声量目标与行为目标是否一致", "Check whether awareness and behavior goals align"),
      t(
        "生成 HTML 后在桌面与移动宽度检查层级和对比度",
        "Check hierarchy and contrast at desktop and mobile widths",
      ),
    ],
    defaultStyle: t(
      "鲜明、克制、系统化、可延展",
      "Distinctive, restrained, systematic, extensible",
    ),
  },
  {
    id: "poster-campaign",
    name: t("海报设计", "Poster campaign"),
    category: "poster",
    format: "PDF",
    summary: t(
      "围绕单一视觉主张制作 A4 或 Letter 页面海报",
      "Create an A4 or Letter page poster around one visual proposition",
    ),
    sections: [
      s(
        "poster-message",
        "视觉主张",
        "Visual proposition",
        "用一句可记忆的话和一个视觉焦点定义海报",
        "Define the poster through one memorable statement and focal point",
      ),
      s(
        "visual-direction",
        "视觉方向",
        "Visual direction",
        "描述构图、影像、材质、光线和情绪，不使用空泛形容词",
        "Specify composition, imagery, texture, light, and mood",
      ),
      s(
        "type-hierarchy",
        "文字层级",
        "Type hierarchy",
        "安排标题、副标题、信息和行动信息的阅读顺序",
        "Sequence title, subtitle, information, and action",
      ),
      s(
        "color-system",
        "色彩系统",
        "Color system",
        "给出主色、辅色、强调色及对比策略",
        "Define primary, secondary, accent, and contrast strategy",
      ),
      s(
        "format-adaptations",
        "页面尺寸",
        "Page size",
        "选择 A4 或 Letter，并在页面内安排完整内容",
        "Choose A4 or Letter and keep all content within the page",
      ),
      s(
        "print-safety",
        "页面可读性",
        "Page readability",
        "检查页面边距、字号、对比度和图像清晰度",
        "Check page margins, type size, contrast, and image clarity",
      ),
    ],
    acceptance: [
      t(
        "三秒内能识别主题、主体和行动",
        "The subject, focal object, and action are clear within three seconds",
      ),
      t("文字层级不依赖装饰也能成立", "Hierarchy works without decorative effects"),
      t(
        "输出 PDF 后检查 A4 或 Letter 页面尺寸、内容溢出和可读性",
        "Check A4 or Letter page size, overflow, and readability in the PDF",
      ),
    ],
    workflow: [
      t(
        "先画黑白缩略图确定焦点与层级",
        "Use black-and-white thumbnails to fix focus and hierarchy",
      ),
      t("用真实素材验证构图而非占位色块", "Validate composition with real assets"),
      t("至少检查一个极端文案长度", "Test an extreme copy length"),
      t(
        "生成 PDF 并完成页面渲染和裁切检查",
        "Render-check the PDF for cropping and page integrity",
      ),
    ],
    defaultStyle: t("强焦点、编辑感、信息清晰", "Focal, editorial, and clear"),
  },
  {
    id: "social-campaign",
    name: t("社媒内容", "Social campaign"),
    category: "marketing",
    format: "HTML",
    summary: t(
      "按平台角色、内容支柱、发布节奏与社区机制运营社媒",
      "Operate social media through platform roles, content pillars, cadence, and community mechanisms",
    ),
    sections: [
      s(
        "platform-roles",
        "平台角色",
        "Platform roles",
        "说明每个平台承担发现、信任、互动或转化中的何种任务",
        "Define whether each platform supports discovery, trust, engagement, or conversion",
      ),
      s(
        "content-pillars",
        "内容支柱",
        "Content pillars",
        "建立可重复但互不重复的内容主题与证据来源",
        "Create repeatable, distinct content themes and evidence sources",
      ),
      s(
        "editorial-calendar",
        "发布节奏",
        "Editorial calendar",
        "给出频率、系列、热点接口和素材准备提前量",
        "Set cadence, series, timely hooks, and production lead time",
      ),
      s(
        "hook-system",
        "开场设计",
        "Hook system",
        "为首屏、标题和前三秒设计多种可测试钩子",
        "Design testable hooks for the first screen or opening seconds",
      ),
      s(
        "community-loop",
        "社区互动",
        "Community loop",
        "安排评论、私信、共创、用户反馈与二次传播",
        "Plan comments, messages, co-creation, feedback, and amplification",
      ),
      s(
        "risk-and-tone",
        "风险与语气",
        "Risk and tone",
        "定义禁用表达、敏感场景、回应边界和升级人",
        "Define prohibited claims, sensitive contexts, response limits, and escalation",
      ),
      s(
        "learning-loop",
        "数据迭代",
        "Learning loop",
        "按触达、停留、互动和转化信号安排复盘",
        "Review reach, retention, engagement, and conversion signals",
      ),
    ],
    acceptance: [
      t("每个平台都有不同而清晰的任务", "Each platform has a distinct, explicit job"),
      t(
        "内容系列可以持续生产且不依赖临时灵感",
        "Content series are repeatable without relying on last-minute inspiration",
      ),
      t(
        "包含负面评论和事实错误的处理边界",
        "Include response boundaries for criticism and factual errors",
      ),
    ],
    workflow: [
      t("先定义受众旅程与平台分工", "Define the audience journey and platform split"),
      t("用真实栏目样张验证内容支柱", "Validate pillars with real sample posts"),
      t("检查每条内容的主张、证据和行动", "Check claim, proof, and action in every post"),
      t("生成 HTML 预览并检查移动端可读性", "Check the HTML preview at mobile width"),
    ],
    defaultStyle: t("平台原生、节奏明快、品牌一致", "Platform-native, rhythmic, brand-consistent"),
  },
  {
    id: "lesson-plan",
    name: t("单课教案", "Lesson plan"),
    category: "learning",
    format: "DOCX",
    summary: t(
      "用目标、起点、活动、分层支持和评估设计一节可授课程",
      "Design one teachable lesson through outcomes, prior knowledge, activities, support, and assessment",
    ),
    sections: [
      s(
        "lesson-context",
        "课程信息",
        "Lesson context",
        "说明对象、时长、先备知识和课堂限制",
        "State learners, duration, prerequisites, and constraints",
      ),
      s(
        "learner-needs",
        "学习者分析",
        "Learner needs",
        "记录已有知识、常见误区和参与障碍",
        "Record prior knowledge, misconceptions, and participation barriers",
      ),
      s(
        "observable-outcomes",
        "可观察目标",
        "Observable outcomes",
        "使用可观察动词描述课后表现与达标证据",
        "Use observable verbs to define performance and evidence",
      ),
      s(
        "lesson-sequence",
        "教学流程",
        "Lesson sequence",
        "按导入、讲解、示范、练习、反馈和收束安排时间",
        "Sequence opening, explanation, demo, practice, feedback, and close",
      ),
      s(
        "supports",
        "分层支持",
        "Differentiation",
        "为不同基础提供提示、挑战和替代路径",
        "Provide hints, extension, and alternate paths",
      ),
      s(
        "materials",
        "材料与媒体",
        "Materials",
        "列出讲义、示例、工具、答案和备用方案",
        "List handouts, examples, tools, answers, and fallback",
      ),
      s(
        "assessment",
        "评估与作业",
        "Assessment",
        "定义课堂检查、作业和反馈标准",
        "Define checks, homework, and feedback criteria",
      ),
    ],
    acceptance: [
      t("每个目标都能由课堂证据验证", "Every outcome can be verified with lesson evidence"),
      t("活动时间总和不超过实际课时", "Activity timings fit the actual lesson length"),
      t("至少包含一种无设备备用方案", "Include at least one no-device fallback"),
    ],
    workflow: [
      t("先对齐目标、练习和评估", "Align outcomes, practice, and assessment first"),
      t("把教师讲解写成关键提问与示范动作", "Turn lecture into key questions and demonstrations"),
      t("按真实时长做一次教学走查", "Walk through the lesson against real timing"),
      t("检查 DOCX 表格、页数和打印效果", "Check DOCX tables, page count, and print layout"),
    ],
    defaultStyle: t("清晰、参与式、低认知负担", "Clear, participative, low-friction"),
  },
  {
    id: "curriculum-design",
    name: t("课程体系", "Curriculum design"),
    category: "learning",
    format: "DOCX",
    summary: t(
      "把能力目标、模块路径、评估证据和质量治理组织成完整课程",
      "Design a complete curriculum from capabilities and modules through assessment and quality governance",
    ),
    sections: [
      s(
        "program-outcomes",
        "能力目标",
        "Capability outcomes",
        "定义毕业或结课时的综合表现与迁移范围",
        "Define end-of-program performance and transfer expectations",
      ),
      s(
        "learner-path",
        "学习路径",
        "Learner path",
        "说明起点、先修关系、阶段和典型节奏",
        "Explain entry level, prerequisites, stages, and pacing",
      ),
      s(
        "module-map",
        "模块地图",
        "Module map",
        "按能力递进组织模块、成果和累计难度",
        "Sequence modules, outcomes, and increasing difficulty",
      ),
      s(
        "practice-system",
        "练习系统",
        "Practice system",
        "安排示范、引导练习、独立项目和间隔复习",
        "Plan demonstrations, guided practice, projects, and spaced review",
      ),
      s(
        "assessment-map",
        "评估图谱",
        "Assessment map",
        "连接形成性、总结性和真实性评估",
        "Connect formative, summative, and authentic assessment",
      ),
      s(
        "accessibility",
        "可及性与差异",
        "Accessibility",
        "覆盖不同基础、设备、语言和学习条件",
        "Support varied backgrounds, devices, languages, and conditions",
      ),
      s(
        "quality-governance",
        "质量治理",
        "Quality governance",
        "定义讲师准备、材料复审、数据复盘和迭代机制",
        "Define instructor readiness, material review, data review, and iteration",
      ),
    ],
    acceptance: [
      t(
        "每个核心能力至少被两次不同评估覆盖",
        "Each capability is covered by at least two assessment forms",
      ),
      t("模块先修关系形成无环学习路径", "Module prerequisites form an acyclic learning path"),
      t(
        "课程目标、活动与评估使用同一能力语言",
        "Outcomes, activities, and assessment share one capability language",
      ),
    ],
    workflow: [
      t("先建立能力图谱再拆分模块", "Build the capability map before modules"),
      t("检查学习负荷和间隔复习", "Check cognitive load and spaced review"),
      t("让非设计者试读目标与评估", "Have a non-designer review outcomes and assessment"),
      t(
        "检查 DOCX 目录、编号、表格和交叉引用",
        "Check DOCX contents, numbering, tables, and references",
      ),
    ],
    defaultStyle: t("系统、可教学、能力导向", "Systematic, teachable, capability-led"),
  },
  {
    id: "financial-model",
    name: t("财务模型", "Financial model"),
    category: "spreadsheet",
    format: "XLSX",
    summary: t(
      "从可追溯假设构建收入、成本、现金流和多情景财务模型",
      "Build a traceable financial model across revenue, cost, cash flow, and scenarios",
    ),
    sections: [
      s(
        "model-scope",
        "模型范围",
        "Model scope",
        "定义业务边界、币种、周期、单位和决策用途",
        "Define business boundary, currency, period, units, and decision use",
      ),
      s(
        "assumptions",
        "核心假设",
        "Assumptions",
        "逐项列出驱动因素、来源、负责人和可接受区间",
        "List drivers, sources, owners, and acceptable ranges",
      ),
      s(
        "revenue-model",
        "收入模型",
        "Revenue model",
        "用客户、价格、转化和留存等驱动构建收入",
        "Build revenue from customers, price, conversion, and retention drivers",
      ),
      s(
        "cost-model",
        "成本与人员",
        "Cost and headcount",
        "分开固定、变动、人员和非经常性成本",
        "Separate fixed, variable, people, and one-time costs",
      ),
      s(
        "cash-flow",
        "现金流",
        "Cash flow",
        "连接营运资本、资本支出、融资和现金余额",
        "Connect working capital, capex, funding, and cash balance",
      ),
      s(
        "scenarios",
        "多情景",
        "Scenarios",
        "建立基准、乐观和保守情景且只改变明确假设",
        "Create base, upside, and downside cases by changing explicit assumptions",
      ),
      s(
        "model-checks",
        "校验与说明",
        "Model checks",
        "提供勾稽检查、错误提示、假设说明和版本记录",
        "Provide reconciliation checks, error flags, notes, and version history",
      ),
    ],
    acceptance: [
      t(
        "所有硬编码输入集中在假设区并可追溯",
        "Hard-coded inputs live in a traceable assumptions area",
      ),
      t("三张核心表勾稽一致且错误检查为零", "Core statements reconcile with zero error flags"),
      t("公式重算后检查空值、异常值和单位", "Recalculate and inspect blanks, outliers, and units"),
    ],
    workflow: [
      t("先列决策问题与模型输出", "Start with the decision and required outputs"),
      t(
        "建立蓝色输入、黑色公式、绿色链接的格式规则",
        "Apply consistent input, formula, and link conventions",
      ),
      t("用平衡检查和极端情景测试模型", "Stress-test with balance checks and extreme cases"),
      t(
        "生成 XLSX 后重开并核对公式、格式和工作表结构",
        "Reopen the XLSX to inspect formulas, formats, and sheet structure",
      ),
    ],
    defaultStyle: t("财务专业、假设透明、审计友好", "Finance-grade, transparent, audit-friendly"),
  },
  {
    id: "data-dashboard",
    name: t("数据看板", "Data dashboard"),
    category: "spreadsheet",
    format: "XLSX",
    summary: t(
      "从业务问题、数据口径、指标模型到异常和刷新机制设计看板",
      "Design a dashboard from business questions, data contracts, and metrics through exceptions and refresh",
    ),
    sections: [
      s(
        "decision-questions",
        "关键问题",
        "Decision questions",
        "列出看板必须支持的判断、行动和使用者",
        "List judgments, actions, and users the dashboard must support",
      ),
      s(
        "data-contract",
        "数据契约",
        "Data contract",
        "定义来源、粒度、时间、字段、所有者和质量规则",
        "Define sources, grain, time, fields, owners, and quality rules",
      ),
      s(
        "metric-dictionary",
        "指标字典",
        "Metric dictionary",
        "说明公式、维度、窗口、排除项和目标",
        "Specify formulas, dimensions, windows, exclusions, and targets",
      ),
      s(
        "data-model",
        "数据模型",
        "Data model",
        "组织事实表、维度表、计算层和刷新关系",
        "Organize facts, dimensions, calculations, and refresh links",
      ),
      s(
        "visual-system",
        "视觉布局",
        "Visual system",
        "按执行摘要、趋势、构成、异常和明细安排图表",
        "Arrange summary, trend, composition, exceptions, and detail",
      ),
      s(
        "exception-view",
        "异常与行动",
        "Exceptions and actions",
        "突出阈值、漂移、缺失值及建议动作",
        "Surface thresholds, drift, missing data, and recommended actions",
      ),
      s(
        "refresh-plan",
        "刷新与治理",
        "Refresh and governance",
        "定义刷新频率、失败回退、版本和权限",
        "Define cadence, failure fallback, versioning, and access",
      ),
    ],
    acceptance: [
      t("每个图表都对应一个明确决策问题", "Every chart maps to an explicit decision question"),
      t("指标公式、时间窗口和排除项完整", "Metric formulas, windows, and exclusions are complete"),
      t(
        "空数据、刷新失败和异常值都有可见状态",
        "Blank, failed refresh, and outlier states are visible",
      ),
    ],
    workflow: [
      t("先做问题清单，不做图表堆叠", "Create the question list before charts"),
      t("用样例数据验证口径与边界", "Validate definitions and edges with sample data"),
      t(
        "检查颜色语义、标签密度和打印可读性",
        "Check color semantics, label density, and print readability",
      ),
      t(
        "生成 XLSX 后重开核对公式、图表引用和异常状态",
        "Reopen the XLSX to verify formulas, chart references, and exceptions",
      ),
    ],
    defaultStyle: t("信息密集、克制、扫描效率优先", "Dense, restrained, scan-efficient"),
  },
  {
    id: "business-case",
    name: t("商业论证", "Business case"),
    category: "spreadsheet",
    format: "XLSX",
    summary: t(
      "用收益、成本、现金流、风险和敏感性支撑投资决策",
      "Support an investment decision through benefits, cost, cash flow, risk, and sensitivity",
    ),
    sections: [
      s(
        "investment-decision",
        "投资问题",
        "Investment decision",
        "说明要批准什么、不批准的后果和决策期限",
        "State what is being approved, the cost of rejection, and the deadline",
      ),
      s(
        "benefit-case",
        "收益测算",
        "Benefit case",
        "把收入、效率、风险和战略收益转为可验证驱动",
        "Translate revenue, efficiency, risk, and strategic value into drivers",
      ),
      s(
        "cost-case",
        "总成本",
        "Total cost",
        "覆盖建设、运营、变更、机会和退出成本",
        "Cover build, run, change, opportunity, and exit costs",
      ),
      s(
        "cash-flow",
        "现金流与回报",
        "Cash flow and return",
        "展示时间序列、净现值、回收期和关键假设",
        "Show time series, NPV, payback, and key assumptions",
      ),
      s(
        "scenarios",
        "情景与敏感",
        "Scenarios and sensitivity",
        "测试关键变量变化对回报和现金需求的影响",
        "Test how key variables affect return and cash needs",
      ),
      s(
        "risk-case",
        "风险与保障",
        "Risk case",
        "列出失败条件、缓解措施和阶段门槛",
        "List failure conditions, mitigations, and stage gates",
      ),
      s(
        "recommendation",
        "建议与条件",
        "Recommendation",
        "给出投资建议、前置条件和复审安排",
        "State recommendation, prerequisites, and review plan",
      ),
    ],
    acceptance: [
      t("收益与基线分开，避免把现状当新增价值", "Separate benefits from baseline value"),
      t("所有关键假设都有来源或明确标记", "Every key assumption has a source or explicit flag"),
      t("包含失败情景、现金峰值和退出条件", "Include failure case, cash peak, and exit conditions"),
    ],
    workflow: [
      t("先定义基线和不投资情景", "Define baseline and no-investment case first"),
      t("建立收益与成本的驱动公式", "Build driver-based benefit and cost formulas"),
      t("让财务与业务假设交叉复核", "Cross-review financial and business assumptions"),
      t(
        "生成 XLSX 后重算并核对勾稽、单位和结论",
        "Recalculate the XLSX and verify checks, units, and conclusions",
      ),
    ],
    defaultStyle: t(
      "决策导向、财务严谨、风险透明",
      "Decision-led, financially rigorous, risk-transparent",
    ),
  },
  {
    id: "product-spec",
    name: t("产品规格", "Product specification"),
    category: "product",
    format: "DOCX",
    summary: t(
      "从用户问题、结果、范围和约束定义可交付、可验证的产品规格",
      "Define a deliverable, verifiable product specification from user problem through scope and constraints",
    ),
    sections: [
      s(
        "product-problem",
        "问题与证据",
        "Problem and evidence",
        "用用户行为、数据和替代方案说明问题",
        "Use user behavior, data, and alternatives to explain the problem",
      ),
      s(
        "users-jobs",
        "用户与任务",
        "Users and jobs",
        "区分主要用户、任务情境和非目标用户",
        "Distinguish primary users, situations, and non-target users",
      ),
      s(
        "product-outcomes",
        "结果与指标",
        "Outcomes and metrics",
        "定义用户结果、业务结果和反指标",
        "Define user, business, and counter-metrics",
      ),
      s(
        "scope",
        "范围与排除",
        "Scope",
        "写清本次必须、可选和明确不做的能力",
        "Specify required, optional, and explicitly excluded capabilities",
      ),
      s(
        "flows",
        "关键流程",
        "Critical flows",
        "逐步描述正常、错误、恢复和权限边界",
        "Describe normal, error, recovery, and permission flows",
      ),
      s(
        "requirements",
        "需求与规则",
        "Requirements",
        "编写可测试行为和业务规则，避免只写 UI 文案",
        "Write testable behavior and rules rather than UI copy only",
      ),
      s(
        "release-proof",
        "上线证据",
        "Release proof",
        "定义埋点、验收、迁移、发布和回退证据",
        "Define telemetry, acceptance, migration, launch, and rollback evidence",
      ),
    ],
    acceptance: [
      t("每项需求都能被测试或观察", "Every requirement can be tested or observed"),
      t(
        "正常、异常、空态和权限边界均有覆盖",
        "Normal, error, empty, and permission states are covered",
      ),
      t("范围排除项和未决问题清晰可见", "Exclusions and open questions are explicit"),
    ],
    workflow: [
      t("先验证问题而不是预设解法", "Validate the problem before the solution"),
      t("把流程画成状态和转换", "Map flows as states and transitions"),
      t(
        "邀请工程、设计和运营做可测试性审查",
        "Review testability with engineering, design, and operations",
      ),
      t(
        "检查 DOCX 标题层级、表格和需求编号",
        "Check DOCX hierarchy, tables, and requirement numbering",
      ),
    ],
    defaultStyle: t("精确、用户导向、工程可执行", "Precise, user-led, engineering-ready"),
  },
  {
    id: "ux-research",
    name: t("用户研究", "UX research"),
    category: "product",
    format: "DOCX",
    summary: t(
      "从研究问题、参与者、证据到优先级形成可行动的用户洞察",
      "Turn research questions, participants, and evidence into actionable user insights",
    ),
    sections: [
      s(
        "research-plan",
        "研究计划",
        "Research plan",
        "定义决策问题、研究问题、方法和时间范围",
        "Define decision questions, research questions, methods, and timing",
      ),
      s(
        "participants",
        "参与者与样本",
        "Participants",
        "说明招募标准、样本结构、排除条件和偏差",
        "Explain recruitment, sample composition, exclusions, and bias",
      ),
      s(
        "method",
        "方法与工具",
        "Method",
        "描述任务、访谈提纲、原型、记录和同意流程",
        "Describe tasks, guides, prototypes, capture, and consent",
      ),
      s(
        "findings",
        "发现与证据",
        "Findings and evidence",
        "按主题呈现观察、引语、频率和反例",
        "Present observations, quotes, frequency, and counterexamples",
      ),
      s(
        "journey-friction",
        "旅程与阻力",
        "Journey friction",
        "定位关键阶段的认知、操作和信任障碍",
        "Locate cognitive, interaction, and trust barriers",
      ),
      s(
        "prioritization",
        "机会优先级",
        "Opportunity priority",
        "按影响、频率、置信度和成本排序",
        "Rank by impact, frequency, confidence, and cost",
      ),
      s(
        "research-decisions",
        "建议与决策",
        "Decisions",
        "明确会改变什么、仍不知道什么和下一步研究",
        "State what changes, what remains unknown, and next research",
      ),
    ],
    acceptance: [
      t("发现能回溯到观察或原话，不写成泛泛人物画像", "Findings trace to observations or quotes"),
      t(
        "反例、样本限制和研究者偏差被说明",
        "Counterexamples, sample limits, and bias are explicit",
      ),
      t(
        "每项建议指向一个可执行产品决定",
        "Each recommendation leads to an actionable product decision",
      ),
    ],
    workflow: [
      t("先确认研究会影响哪个决定", "Confirm which decision the research informs"),
      t("用真实任务做试点并修正提纲", "Pilot with a real task and revise the guide"),
      t("从证据聚类后再命名主题", "Cluster evidence before naming themes"),
      t(
        "检查 DOCX 引语、图表、附录和同意信息",
        "Check DOCX quotes, charts, appendix, and consent notes",
      ),
    ],
    defaultStyle: t("证据密度高、语气克制、行动明确", "Evidence-rich, restrained, action-oriented"),
  },
  {
    id: "release-readiness",
    name: t("发布就绪", "Release readiness"),
    category: "engineering",
    format: "DOCX",
    summary: t(
      "通过范围、兼容、验证、观测、回退和 go/no-go 评审发布风险",
      "Review release risk through scope, compatibility, verification, observability, rollback, and go/no-go",
    ),
    sections: [
      s(
        "release-scope",
        "发布范围",
        "Release scope",
        "列出变更、受影响用户、系统和不在范围内事项",
        "List changes, affected users and systems, and exclusions",
      ),
      s(
        "change-review",
        "变更审查",
        "Change review",
        "汇总高风险改动、依赖、迁移和配置变化",
        "Summarize risky changes, dependencies, migrations, and config",
      ),
      s(
        "compatibility",
        "兼容性",
        "Compatibility",
        "覆盖平台、数据、协议、回滚和旧客户端",
        "Cover platform, data, protocol, rollback, and old clients",
      ),
      s(
        "verification",
        "验证矩阵",
        "Verification matrix",
        "列出自动、手工、环境、结果和未验证项",
        "List automated, manual, environment, results, and gaps",
      ),
      s(
        "observability",
        "观测与值守",
        "Observability",
        "定义指标、日志、告警、值守人员和观察窗",
        "Define metrics, logs, alerts, on-call, and observation window",
      ),
      s(
        "rollback",
        "回退方案",
        "Rollback",
        "给出触发条件、步骤、数据影响和预计时长",
        "Give triggers, steps, data impact, and duration",
      ),
      s(
        "go-no-go",
        "发布裁决",
        "Go/no-go",
        "记录阻塞项、接受风险和最终有权决定人",
        "Record blockers, accepted risks, and final decision owner",
      ),
    ],
    acceptance: [
      t("构建版本、提交和产物可唯一识别", "Build, commit, and artifacts are uniquely identifiable"),
      t("每个阻塞项都有状态和明确负责人", "Every blocker has status and an explicit owner"),
      t("回退方案覆盖数据与配置而不只是一条命令", "Rollback covers data and configuration"),
    ],
    workflow: [
      t("从实际变更和依赖生成审查清单", "Generate the review from actual changes and dependencies"),
      t("区分已运行验证与仅检查代码", "Separate executed verification from code inspection"),
      t("在发布候选版本上演练关键回退", "Rehearse critical rollback on the release candidate"),
      t("检查 DOCX 证据链接、版本号和签署区", "Check DOCX evidence, versions, and sign-off"),
    ],
    defaultStyle: t(
      "证据驱动、保守、阻塞透明",
      "Evidence-driven, conservative, blocker-transparent",
    ),
  },
  {
    id: "architecture-decision",
    name: t("架构决策", "Architecture decision"),
    category: "engineering",
    format: "DOCX",
    summary: t(
      "用上下文、约束、选项、后果和验证记录可追溯的架构决定",
      "Record a traceable architecture decision through context, constraints, options, consequences, and validation",
    ),
    sections: [
      s(
        "architecture-context",
        "架构上下文",
        "Architecture context",
        "说明系统边界、质量属性、当前状态和触发因素",
        "State boundaries, quality attributes, current state, and trigger",
      ),
      s(
        "hard-constraints",
        "约束与不变量",
        "Constraints and invariants",
        "列出兼容、合规、性能、团队和能力限制",
        "List compatibility, compliance, performance, team, and capability limits",
      ),
      s(
        "decision-options",
        "候选方案",
        "Options",
        "描述至少三个可行方案及关键接口",
        "Describe at least three viable options and interfaces",
      ),
      s(
        "tradeoffs",
        "权衡矩阵",
        "Tradeoff matrix",
        "按加权标准比较复杂度、成本、风险与演进性",
        "Compare complexity, cost, risk, and evolvability",
      ),
      s(
        "decision-record",
        "决定与理由",
        "Decision",
        "记录选择、拒绝项、前置条件和负责人",
        "Record the choice, rejections, prerequisites, and owner",
      ),
      s(
        "consequences",
        "后果",
        "Consequences",
        "说明运维、开发、迁移、安全和可逆性影响",
        "Explain operations, development, migration, security, and reversibility",
      ),
      s(
        "validation",
        "验证与复审",
        "Validation",
        "定义原型、指标、失败信号和复审时点",
        "Define prototypes, metrics, failure signals, and review",
      ),
    ],
    acceptance: [
      t(
        "质量属性和淘汰条件先于方案描述",
        "Quality attributes and elimination rules precede options",
      ),
      t("决定明确列出被拒绝方案及理由", "The decision names rejected options and why"),
      t(
        "至少有一项可执行验证或失败信号",
        "Include at least one executable validation or failure signal",
      ),
    ],
    workflow: [
      t("先写不变量与质量属性", "Write invariants and quality attributes first"),
      t("用最小原型验证最高风险假设", "Prototype the riskiest assumption"),
      t("检查决定对交付和运维团队的影响", "Check impacts on delivery and operations"),
      t("检查 DOCX 图表、链接、术语和状态", "Check DOCX diagrams, links, terminology, and status"),
    ],
    defaultStyle: t("架构化、取舍明确、可追溯", "Architectural, decisive, traceable"),
  },
  {
    id: "onboarding-program",
    name: t("入职项目", "Onboarding program"),
    category: "people",
    format: "DOCX",
    summary: t(
      "让新成员从角色结果、关系、学习与检查点快速形成贡献",
      "Help new team members contribute through role outcomes, relationships, learning, and checkpoints",
    ),
    sections: [
      s(
        "role-outcomes",
        "角色结果",
        "Role outcomes",
        "定义第30、60、90天应产生的可观察结果",
        "Define observable outcomes for days 30, 60, and 90",
      ),
      s(
        "newcomer-context",
        "新人背景",
        "Newcomer context",
        "说明角色差异、已有优势和需要补足的组织知识",
        "Explain role variation, strengths, and organizational knowledge gaps",
      ),
      s(
        "journey",
        "入职旅程",
        "Onboarding journey",
        "按入职前、首日、首周、首月和首季组织体验",
        "Sequence preboarding, day one, week one, month one, and quarter one",
      ),
      s(
        "learning-path",
        "学习路径",
        "Learning path",
        "列出必要知识、实践任务、资料和完成证据",
        "List knowledge, practice, resources, and completion evidence",
      ),
      s(
        "relationships",
        "关系网络",
        "Relationship map",
        "安排经理、伙伴、跨团队接口和主题专家",
        "Plan manager, buddy, interfaces, and subject experts",
      ),
      s(
        "checkpoints",
        "检查点",
        "Checkpoints",
        "定义每次对话的问题、负责人和调整动作",
        "Define questions, owners, and adjustments for each conversation",
      ),
      s(
        "feedback-loop",
        "反馈与改进",
        "Feedback loop",
        "收集新人、经理和团队反馈并迭代流程",
        "Collect newcomer, manager, and team feedback and iterate",
      ),
    ],
    acceptance: [
      t("成功不是完成课程，而是产生角色结果", "Success means role outcomes, not course completion"),
      t("每项学习任务都有实践和反馈来源", "Every learning task has practice and feedback"),
      t("经理和新人清楚每个检查点的预期", "Manager and newcomer know each checkpoint expectation"),
    ],
    workflow: [
      t("从真实角色结果倒推入职任务", "Derive onboarding from actual role outcomes"),
      t("删去只提供信息但没有应用的任务", "Remove information-only tasks without application"),
      t("让近期入职者走查时间安排", "Have a recent hire review the schedule"),
      t("检查 DOCX 表格、清单和责任人", "Check DOCX tables, checklists, and owners"),
    ],
    defaultStyle: t("欢迎感、实用、结果导向", "Welcoming, practical, outcome-led"),
  },
  {
    id: "performance-review",
    name: t("绩效复盘", "Performance review"),
    category: "people",
    format: "DOCX",
    summary: t(
      "用期望、成果、行为、证据和发展计划形成公平的绩效对话",
      "Build a fair performance conversation from expectations, outcomes, behaviors, evidence, and growth",
    ),
    sections: [
      s(
        "role-expectations",
        "角色期望",
        "Role expectations",
        "复述当前岗位的结果、行为和职责边界",
        "Restate current outcomes, behaviors, and responsibility boundaries",
      ),
      s(
        "outcomes",
        "成果回顾",
        "Outcomes",
        "按目标、权重、结果和情境证据回顾成果",
        "Review goals, weights, results, and context evidence",
      ),
      s(
        "behaviors",
        "协作行为",
        "Behaviors",
        "评估对团队、质量和价值观的实际影响",
        "Assess actual impact on team, quality, and values",
      ),
      s(
        "evidence",
        "证据与反馈",
        "Evidence and feedback",
        "使用多来源、可核验案例，避免人格判断",
        "Use multi-source, verifiable examples rather than personality labels",
      ),
      s(
        "growth",
        "优势与发展",
        "Strengths and growth",
        "区分已验证优势、盲区和下一阶段能力",
        "Separate proven strengths, blind spots, and next capabilities",
      ),
      s(
        "feedback-plan",
        "反馈计划",
        "Feedback plan",
        "安排反馈对话、倾听、异议和确认机制",
        "Plan the feedback conversation, listening, disagreement, and confirmation",
      ),
      s(
        "development",
        "发展行动",
        "Development actions",
        "定义行动、支持、检查点和成功证据",
        "Define actions, support, checkpoints, and success evidence",
      ),
    ],
    acceptance: [
      t(
        "结论基于行为与结果证据，不使用标签化评价",
        "Conclusions use behavior and outcome evidence",
      ),
      t("成果回顾包含情境、权重和变化", "Outcome review includes context, weighting, and change"),
      t("发展行动可执行且有检查时点", "Development actions are actionable and scheduled"),
    ],
    workflow: [
      t("先收集多来源证据并核对事实", "Collect multi-source evidence and verify facts"),
      t("区分结果、行为和未来潜力", "Separate results, behavior, and future potential"),
      t("用具体场景改写抽象评价", "Rewrite abstract judgments as concrete situations"),
      t("检查 DOCX 隐私、权限、表格和措辞", "Check DOCX privacy, access, tables, and language"),
    ],
    defaultStyle: t("尊重、具体、发展导向", "Respectful, specific, development-led"),
  },
  {
    id: "incident-review",
    name: t("事故复盘", "Incident review"),
    category: "operations",
    format: "DOCX",
    summary: t(
      "以时间线、影响、响应和系统性根因形成无责事故复盘",
      "Create a blameless review through timeline, impact, response, and systemic causes",
    ),
    sections: [
      s(
        "incident-summary",
        "事故摘要",
        "Incident summary",
        "用事实说明发生了什么、影响多久和当前状态",
        "State what happened, impact duration, and current status",
      ),
      s(
        "timeline",
        "时间线",
        "Timeline",
        "按时间记录检测、通报、处置、恢复和验证",
        "Record detection, communication, response, recovery, and validation",
      ),
      s(
        "impact",
        "影响范围",
        "Impact",
        "量化用户、数据、财务、合规和服务影响",
        "Quantify user, data, financial, compliance, and service impact",
      ),
      s(
        "detection",
        "检测与响应",
        "Detection and response",
        "分析发现速度、告警质量、协作和决策延迟",
        "Analyze detection speed, alerts, collaboration, and decision delays",
      ),
      s(
        "causes",
        "系统原因",
        "Systemic causes",
        "区分触发事件、条件、控制缺口和系统性因素",
        "Separate trigger, conditions, control gaps, and systemic factors",
      ),
      s(
        "corrective-actions",
        "纠正行动",
        "Corrective actions",
        "定义责任人、截止日期、验证方式和风险优先级",
        "Define owners, dates, verification, and risk priority",
      ),
      s(
        "learning",
        "经验与演练",
        "Learning and rehearsal",
        "记录可复用经验、沟通模板和后续演练",
        "Capture reusable lessons, templates, and rehearsal",
      ),
    ],
    acceptance: [
      t("时间线区分事实、推断和未知信息", "Timeline separates facts, inferences, and unknowns"),
      t("根因分析避免归咎个人，聚焦系统条件", "Root-cause analysis focuses on system conditions"),
      t("每项纠正行动都有验证证据", "Every corrective action has verification evidence"),
    ],
    workflow: [
      t("先固定时间源和事实口径", "Fix timeline sources and factual definitions"),
      t("用五个为什么之外的因果图寻找系统因素", "Use causal mapping beyond five-whys"),
      t("检查行动是否真正降低再次发生概率", "Check whether actions reduce recurrence risk"),
      t(
        "检查 DOCX 附件、证据链接和敏感信息",
        "Check DOCX attachments, evidence links, and sensitive data",
      ),
    ],
    defaultStyle: t("无责、事实优先、系统改进", "Blameless, factual, system-focused"),
  },
  {
    id: "governance-review",
    name: t("治理评审", "Governance review"),
    category: "operations",
    format: "DOCX",
    summary: t(
      "通过授权、控制、证据、发现和整改检查治理有效性",
      "Assess governance effectiveness through mandate, controls, evidence, findings, and remediation",
    ),
    sections: [
      s(
        "governance-mandate",
        "治理授权",
        "Governance mandate",
        "说明评审范围、授权来源、独立性和边界",
        "State scope, authority, independence, and boundaries",
      ),
      s(
        "control-objectives",
        "控制目标",
        "Control objectives",
        "定义要防范的风险和期望控制结果",
        "Define risks and expected control outcomes",
      ),
      s(
        "evidence",
        "证据抽样",
        "Evidence sample",
        "记录样本、来源、覆盖期、完整性和限制",
        "Record samples, sources, period, completeness, and limits",
      ),
      s(
        "findings",
        "评审发现",
        "Findings",
        "按条件、标准、影响和原因编写发现",
        "Write findings by condition, criterion, impact, and cause",
      ),
      s(
        "risk-rating",
        "风险分级",
        "Risk rating",
        "结合可能性、影响、补偿控制和紧迫性",
        "Combine likelihood, impact, compensating controls, and urgency",
      ),
      s(
        "decisions",
        "治理决定",
        "Decisions",
        "记录接受、整改、例外和升级决定",
        "Record acceptance, remediation, exception, and escalation",
      ),
      s(
        "remediation",
        "整改计划",
        "Remediation",
        "定义责任、日期、证据和复查方式",
        "Define ownership, dates, evidence, and retest",
      ),
    ],
    acceptance: [
      t("评审范围、授权和限制明确", "Scope, authority, and limitations are explicit"),
      t("每项发现都有标准、证据和影响", "Every finding has criterion, evidence, and impact"),
      t("风险分级和整改责任可复核", "Risk ratings and remediation ownership are reviewable"),
    ],
    workflow: [
      t("先确认评审授权和控制框架", "Confirm authority and control framework first"),
      t("按风险选择样本并保留抽样依据", "Select samples by risk and retain rationale"),
      t("让被评审方事实复核后再定级", "Validate facts before final rating"),
      t(
        "检查 DOCX 附件、保密级别和交叉引用",
        "Check DOCX attachments, confidentiality, and references",
      ),
    ],
    defaultStyle: t("正式、可审计、结论克制", "Formal, auditable, measured"),
  },
];

// Existing drafts use these IDs and the corresponding variant section IDs.
const VARIANT_IDS = [
  "executive",
  "board",
  "investor",
  "client",
  "internal-team",
  "workshop",
  "sales",
  "public",
  "technical",
  "beginner",
  "decision",
  "retrospective",
] as const;

function variantsForFamily(family: FamilyDefinition): VariantDefinition[] {
  const groups = CREATIVE_FAMILY_SCENARIOS[family.id];
  const scenarios = groups?.flatMap((group) =>
    group.scenarios.map((name) => ({ name, audience: group.audience, check: group.acceptance })),
  );
  if (!scenarios || scenarios.length !== VARIANT_IDS.length) {
    throw new Error(`Creative template family ${family.id} must define 12 scenarios`);
  }
  return scenarios.map(({ name, audience, check }, index) => {
    const id = VARIANT_IDS[index];
    if (!id) throw new Error(`Missing legacy variant ID for ${family.id}`);
    return {
      id,
      name,
      audience,
      section: s(
        `variant-${id}`,
        `${name.zh}要点`,
        `${name.en} considerations`,
        `针对${name.zh}：${check.zh}`,
        `For ${name.en.toLowerCase()}: ${check.en}`,
      ),
      acceptance: [
        check,
        t(
          `明确「${name.zh}」所需资料及尚未确认的信息`,
          `Identify source material and unresolved information for ${name.en.toLowerCase()}`,
        ),
      ],
    };
  });
}

function recommendedSkills(
  format: CreativeTemplateFormat | null,
  category: CreativeTemplateCategory,
): CreativeRecommendedSkill[] {
  const skills: CreativeRecommendedSkill[] = [];
  const add = (id: string, name: string, nameEn: string, reason: string, reasonEn: string) => {
    if (!skills.some((item) => item.id === id)) skills.push({ id, name, nameEn, reason, reasonEn });
  };
  if (format === "DOCX")
    add(
      "builtin:work-word",
      "Word 专业文档",
      "Word authoring",
      "安排文档结构、样式、表格和分页。",
      "Structure and style the document, tables, and pagination.",
    );
  if (format === "XLSX")
    add(
      "builtin:work-spreadsheets",
      "Excel 表格",
      "Excel workbooks",
      "建立可编辑表格、类型、公式与勾稽。",
      "Build editable tables, typed data, formulas, and reconciliations.",
    );
  if (format === "PPTX") {
    add(
      "builtin:work-presentations",
      "演示文稿",
      "Presentations",
      "设计叙事、页面结构和演示可读性。",
      "Design the narrative, slide structure, and presentation readability.",
    );
    add(
      "builtin:work-ppt-master",
      "PPT Master",
      "PPT Master",
      "按需辅助版式、可编辑内容和逐页检查。",
      "Support layout, editable content, and slide-by-slide review when relevant.",
    );
  }
  if (format === "PDF")
    add(
      "builtin:work-pdf",
      "PDF 文档",
      "PDF documents",
      "检查页面、文字、链接及实际渲染。",
      "Inspect pages, text, links, and actual rendering.",
    );
  if (format === "HTML")
    add(
      "builtin:work-visualization",
      "可视化",
      "Visualization",
      "构建可访问的交互内容并检查浏览器呈现。",
      "Build accessible interactive content and check browser rendering.",
    );
  if (category === "poster" || category === "marketing")
    add(
      "builtin:work-visual-design",
      "视觉设计",
      "Visual design",
      "建立视觉层级、网格与素材使用边界。",
      "Establish visual hierarchy, grids, and asset-use boundaries.",
    );
  if (["spreadsheet", "research", "planning"].includes(category))
    add(
      "builtin:work-analysis",
      "数据分析",
      "Data analysis",
      "核对数据粒度、指标口径和不确定性。",
      "Check data grain, metric definitions, and uncertainty.",
    );
  if (category === "research")
    add(
      "builtin:work-research",
      "资料研究",
      "Research",
      "组织来源、引用、反证与事实核查。",
      "Organize sources, citations, counterevidence, and factual review.",
    );
  if (
    ["operations", "planning", "people", "document", "learning", "spreadsheet"].includes(category)
  )
    add(
      "builtin:work-operations",
      "办公流程",
      "Work operations",
      "梳理流程、角色、行动项和交接。",
      "Organize workflows, roles, action items, and handoffs.",
    );
  add(
    "builtin:artifact-quality",
    "交付物质量",
    "Artifact quality",
    "检查内容准确性、可读性和实际验证状态。",
    "Check factual accuracy, readability, and actual verification status.",
  );
  return skills;
}

function localized(pair: CreativeTranslation): LocalizedText {
  return { zh: pair[0], en: pair[1] };
}

const LEGACY_DETAILED_CASES = {
  ...LEGACY_DETAILED_CASES_A,
  ...LEGACY_DETAILED_CASES_B,
  ...LEGACY_DETAILED_CASES_C,
};

function buildTemplate(family: FamilyDefinition, variant: VariantDefinition): CreativeTemplate {
  const sections = [...family.sections, variant.section];
  const index = (VARIANT_IDS as readonly string[]).indexOf(variant.id);
  const guide = LEGACY_DETAILED_CASES[family.id]?.[index];
  const playbook = LEGACY_CREATIVE_PLAYBOOKS[family.id];
  if (!guide) throw new Error(`Missing creative scenario guide for ${family.id}--${variant.id}`);
  if (!playbook) throw new Error(`Missing creative family playbook for ${family.id}`);
  const detailedPlan: CreativeDetailedPlan = {
    inputs: localized(guide.inputs),
    focus: localized(guide.focus),
    output: localized(guide.output),
    risk: localized(guide.risk),
    playbook: {
      inputs: localized(playbook.inputs),
      method: localized(playbook.method),
      design: localized(playbook.design),
      checks: localized(playbook.checks),
    },
  };
  return {
    id: `${family.id}--${variant.id}`,
    familyId: family.id,
    variantId: variant.id,
    name: `${family.name.zh} · ${variant.name.zh}`,
    nameEn: `${family.name.en} · ${variant.name.en}`,
    category: family.category,
    format: family.format,
    summary: `${family.summary.zh}，适用于${variant.name.zh}。`,
    summaryEn: `${family.summary.en}, for ${variant.name.en.toLowerCase()}.`,
    detailedDescription: `${family.summary.zh}。${guide.focus[0]} ${guide.output[0]}`,
    detailedDescriptionEn: `${family.summary.en}. ${guide.focus[1]} ${guide.output[1]}`,
    recommendedSkills: recommendedSkills(family.format, family.category),
    detailedPlan,
    defaultAudience: variant.audience.zh,
    defaultAudienceEn: variant.audience.en,
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title.zh,
      titleEn: section.title.en,
      intent: section.intent.zh,
      intentEn: section.intent.en,
    })),
    acceptance: [
      ...family.acceptance.map((item) => item.zh),
      ...variant.acceptance.map((item) => item.zh),
    ],
    acceptanceEn: [
      ...family.acceptance.map((item) => item.en),
      ...variant.acceptance.map((item) => item.en),
    ],
    workflow: family.workflow.map((item) => item.zh),
    workflowEn: family.workflow.map((item) => item.en),
    tags: [
      family.id,
      family.name.zh,
      family.name.en,
      family.category,
      variant.name.zh,
      variant.name.en,
    ],
  };
}

function buildExtendedTemplate(family: CreativeExtendedFamily, index: number): CreativeTemplate {
  const scenario = family.scenarios[index];
  const variantId = VARIANT_IDS[index];
  if (!scenario || !variantId)
    throw new Error(`Invalid creative scenario ${family.id} at ${index}`);
  const sectionId = `variant-${variantId}`;
  const brief = scenario.brief ?? scenario;
  const detailedPlan: CreativeDetailedPlan = {
    inputs: localized(scenario.inputs),
    focus: localized(scenario.focus),
    output: localized(scenario.output),
    risk: localized(scenario.risk),
    playbook: {
      inputs: localized(family.playbook.inputs),
      method: localized(family.playbook.method),
      design: localized(family.playbook.design),
      checks: localized(family.playbook.checks),
    },
  };
  return {
    id: `${family.id}--${variantId}`,
    familyId: family.id,
    variantId,
    name: `${family.name[0]} · ${scenario.name[0]}`,
    nameEn: `${family.name[1]} · ${scenario.name[1]}`,
    category: family.category,
    format: family.format,
    summary: `${family.summary[0]}，适用于${scenario.name[0]}。`,
    summaryEn: `${family.summary[1]}, for ${scenario.name[1].toLowerCase()}.`,
    detailedDescription: `${family.summary[0]}。${scenario.focus[0]} ${scenario.output[0]}`,
    detailedDescriptionEn: `${family.summary[1]}. ${scenario.focus[1]} ${scenario.output[1]}`,
    recommendedSkills: recommendedSkills(family.format, family.category),
    detailedPlan,
    defaultAudience: scenario.audience[0],
    defaultAudienceEn: scenario.audience[1],
    sections: [
      ...family.sections.map(([id, title, titleEn, intent, intentEn]) => ({
        id,
        title,
        titleEn,
        intent,
        intentEn,
      })),
      {
        id: sectionId,
        title: `${scenario.name[0]}要点`,
        titleEn: `${scenario.name[1]} considerations`,
        intent: brief.focus[0],
        intentEn: brief.focus[1],
      },
    ],
    acceptance: [...family.acceptance.map((item) => item[0]), brief.output[0], brief.risk[0]],
    acceptanceEn: [...family.acceptance.map((item) => item[1]), brief.output[1], brief.risk[1]],
    workflow: family.workflow.map((item) => item[0]),
    workflowEn: family.workflow.map((item) => item[1]),
    tags: [
      family.id,
      family.name[0],
      family.name[1],
      family.category,
      scenario.name[0],
      scenario.name[1],
      ...(scenario.tags ?? []),
    ],
  };
}

const EXTENDED_FAMILIES = [
  ...EXTENDED_CREATIVE_FAMILIES_A,
  ...EXTENDED_CREATIVE_FAMILIES_B,
  ...EXTENDED_CREATIVE_FAMILIES_C,
];

export const CREATIVE_TEMPLATES: ReadonlyArray<CreativeTemplate> = [
  ...FAMILIES.flatMap((family) =>
    variantsForFamily(family).map((variant) => buildTemplate(family, variant)),
  ),
  ...EXTENDED_FAMILIES.flatMap((family) => {
    if (family.scenarios.length !== VARIANT_IDS.length)
      throw new Error(`Creative template family ${family.id} must define 12 scenarios`);
    return family.scenarios.map((_, index) => buildExtendedTemplate(family, index));
  }),
];

export function creativeCategoryLabel(
  category: CreativeTemplateCategory,
  locale: "zh-CN" | "en" = "zh-CN",
): string {
  const item = CREATIVE_TEMPLATE_CATEGORIES.find((entry) => entry.id === category);
  return locale === "en" ? (item?.labelEn ?? category) : (item?.label ?? category);
}

export function findCreativeTemplate(id: string): CreativeTemplate | null {
  return CREATIVE_TEMPLATES.find((template) => template.id === id) ?? null;
}

export function parseCreativeDeliverableFormat(value: string): CreativeTemplateFormat | null {
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  const formats: Readonly<Record<string, CreativeTemplateFormat>> = {
    PPTX: "PPTX",
    ".PPTX": "PPTX",
    PPT: "PPTX",
    POWERPOINT: "PPTX",
    DOCX: "DOCX",
    ".DOCX": "DOCX",
    WORD: "DOCX",
    XLSX: "XLSX",
    ".XLSX": "XLSX",
    EXCEL: "XLSX",
    PDF: "PDF",
    ".PDF": "PDF",
    HTML: "HTML",
    ".HTML": "HTML",
    ".HTM": "HTML",
  };
  return formats[normalized] ?? null;
}

function nonBlankOr(value: string, fallback: string): string {
  return value.trim() ? value : fallback;
}

function defaultTemplateStyle(template: CreativeTemplate, locale: "zh-CN" | "en"): string {
  const family = FAMILIES.find((item) => item.id === template.familyId);
  const extended = EXTENDED_FAMILIES.find((item) => item.id === template.familyId);
  return family
    ? locale === "en"
      ? family.defaultStyle.en
      : family.defaultStyle.zh
    : extended
      ? extended.style[locale === "en" ? 1 : 0]
      : "";
}

export function creativeSkillsForDraft(
  template: CreativeTemplate,
  draft: CreativeWorkspaceDraft,
): CreativeRecommendedSkill[] {
  const format = parseCreativeDeliverableFormat(nonBlankOr(draft.deliverable, template.format));
  return recommendedSkills(format, template.category);
}

export function createCreativeDraft(
  template: CreativeTemplate,
  locale: "zh-CN" | "en" = "zh-CN",
): CreativeWorkspaceDraft {
  return {
    version: 1,
    promptMode: "detailed",
    templateId: template.id,
    title: locale === "en" ? template.nameEn : template.name,
    subject: "",
    audience: locale === "en" ? template.defaultAudienceEn : template.defaultAudience,
    purpose: locale === "en" ? template.summaryEn : template.summary,
    sourceMaterials: "",
    deliverable: template.format,
    style: defaultTemplateStyle(template, locale),
    constraints: "",
    sections: template.sections.map((section) => ({
      id: section.id,
      title: locale === "en" ? section.titleEn : section.title,
      notes: "",
    })),
    updatedAt: new Date().toISOString(),
  };
}

function sectionPrompt(
  draft: CreativeWorkspaceDraft,
  template: CreativeTemplate,
  locale: "zh-CN" | "en",
  includeIntent = true,
): string {
  return draft.sections
    .map((section, index) => {
      const source = template.sections.find((item) => item.id === section.id);
      // Imported older drafts can retain a former section under the same stable ID.
      const matchesTitle =
        source && (section.title === source.title || section.title === source.titleEn);
      const intent =
        includeIntent && matchesTitle
          ? adaptTemplateText(
              locale === "en" ? source.intentEn : source.intent,
              template,
              draft,
              locale,
            )
          : "";
      const title = matchesTitle
        ? adaptTemplateText(section.title, template, draft, locale)
        : section.title;
      const notes = section.notes;
      if (locale === "en")
        return `${index + 1}. ${title}${intent ? ` - ${intent}` : ""}${notes.trim() ? `\n   Notes: ${notes}` : ""}`;
      return `${index + 1}. ${title}${intent ? `——${intent}` : ""}${notes.trim() ? `\n   用户补充：${notes}` : ""}`;
    })
    .join("\n");
}

function adaptTemplateText(
  value: string,
  template: CreativeTemplate,
  draft: CreativeWorkspaceDraft,
  locale: "zh-CN" | "en",
): string {
  const selectedFormat = parseCreativeDeliverableFormat(
    nonBlankOr(draft.deliverable, template.format),
  );
  const text =
    selectedFormat === "PDF" || !selectedFormat
      ? value
          .replace(/可编辑的?(?=文件|成果|文档|文稿|表格|工作簿)/gu, "")
          .replace(/\ban editable (?=file|deliverable|draft|document|workbook)/gi, "a ")
          .replace(/\beditable (?=file|deliverable|draft|document|workbook)/gi, "")
      : value;
  if (selectedFormat === template.format) return text;
  const english = locale === "en";
  const file = english ? "deliverable" : "交付文件";
  const section = english ? "sections" : "内容分区";
  const format = english ? "selected format" : "所选格式";
  if (template.format === "XLSX")
    return text
      .replace(/工作簿/g, file)
      .replace(/工作表/g, section)
      .replace(/\bworkbooks?\b/gi, file)
      .replace(/\bworksheets?\b/gi, section)
      .replace(/\b(?:XLSX|Excel)\b/gi, format);
  if (template.format === "PPTX")
    return text
      .replace(/幻灯片|演示文稿/g, section)
      .replace(/\b(?:slides?|decks?)\b/gi, section)
      .replace(/\b(?:PPTX|PowerPoint)\b/gi, format);
  if (template.format === "DOCX")
    return text
      .replace(/Word\s*文档|Word\s*文稿/gi, file)
      .replace(/\bWord\s+documents?\b/gi, file)
      .replace(/\b(?:DOCX|Word)\b/gi, format);
  if (template.format === "PDF") return text.replace(/\bPDF\b/gi, format);
  return text.replace(/\bHTML\b/gi, format);
}

function draftStylePrompt(
  template: CreativeTemplate,
  draft: CreativeWorkspaceDraft,
  locale: "zh-CN" | "en",
): string {
  const family = FAMILIES.find((item) => item.id === template.familyId);
  const extended = EXTENDED_FAMILIES.find((item) => item.id === template.familyId);
  const defaults = [
    family?.defaultStyle.zh,
    family?.defaultStyle.en,
    extended?.style[0],
    extended?.style[1],
  ];
  const style = nonBlankOr(draft.style, defaultTemplateStyle(template, locale));
  return defaults.includes(style) ? adaptTemplateText(style, template, draft, locale) : style;
}

const FORMAT_DETAIL: Readonly<Record<CreativeTemplateFormat, LocalizedText>> = {
  PPTX: t(
    "先明确受众决策并以结论组织每页。采用统一网格、清晰层级和留白，按内容选用比较、流程或图表，标注单位和来源，密集表格移入附录。保留可编辑文本和图形；逐页检查字号、溢出、裁切、对比及标签，未渲染须标为未验证。",
    "Organize each slide around the audience's decision and a clear conclusion. Use a consistent grid, hierarchy, and whitespace; choose comparisons, processes, or charts to suit the content, with units and sources. Move dense tables to an appendix. Keep text and shapes editable; inspect type, overflow, clipping, contrast, and labels, and mark rendering unverified when unavailable.",
  ),
  DOCX: t(
    "先给摘要、结论与行动，后附依据。使用语义标题和一致间距；检查表头、列宽、跨页、引用及正文数字一致性。复核孤行、目录、链接和可访问性；旧稿编辑保留原件并核对未改动部分，未渲染不得声称通过。",
    "Lead with a summary, findings, and action, followed by evidence. Use semantic headings and consistent spacing; check table headers, widths, page breaks, citations, and numerical consistency. Review widows, contents, links, and accessibility. Preserve the original and inspect unchanged parts when editing; do not claim rendering passed if it was unavailable.",
  ),
  XLSX: t(
    "分离原始数据、假设、计算、结果与异常；注明粒度、单位和期间，数字日期保持类型、编号存文本。输入与公式分区，避免危险外部引用及隐藏常数，关键汇总勾稽，缺失不当作零；核验公式、边界值及实际重算状态。",
    "Separate source data, assumptions, calculations, results, and exceptions; state grain, units, and period. Keep numbers and dates typed and IDs as text. Separate inputs and formulas, avoid unsafe external references and hidden constants, reconcile totals, and never treat missing values as zero. Check formulas, edge cases, and actual recalculation status.",
  ),
  PDF: t(
    "先核实页面用途和尺寸，海报仅用工具支持的 A4 或 Letter。确保关键信息、阅读顺序和对比可读；素材需授权并记录来源。逐页检查文字提取、清晰度、链接和裁切；未渲染或授权未核实须标明。",
    "Confirm page use and supported size; posters use A4 or Letter. Keep key information, reading order, and contrast legible, and record asset sources and permissions. Inspect each page for text extraction, image quality, links, and clipping; disclose unrendered pages or unverified rights.",
  ),
  HTML: t(
    "围绕读者任务组织内容，控件标明名称、键盘操作和状态；图表说明数据、刻度、单位并提供文字替代。检查不同宽度的换行、重叠和焦点；避免未授权素材或依赖，实际打开检查交互与控制台，未执行须标为未验证。",
    "Organize content around reader tasks; label controls, keyboard behavior, and state. Explain chart data, scales, and units with text alternatives. Check wrapping, overlap, and focus at different widths; avoid unauthorized assets or dependencies, open the result to inspect interactions and the console, and disclose unverified checks.",
  ),
};

function detailedPrompt(
  template: CreativeTemplate,
  draft: CreativeWorkspaceDraft,
  locale: "zh-CN" | "en",
  workspacePath: string | null,
  scenarioChanged: boolean,
): string {
  const english = locale === "en";
  const language = english ? "en" : "zh";
  const plan = template.detailedPlan;
  const playbook = plan.playbook;
  const rawDeliverable = nonBlankOr(draft.deliverable, template.format);
  const chosenFormat = parseCreativeDeliverableFormat(rawDeliverable);
  const formatChanged = chosenFormat !== template.format;
  const formatGuide = chosenFormat ? FORMAT_DETAIL[chosenFormat] : null;
  const adapt = (value: string) => adaptTemplateText(value, template, draft, locale);
  const templateName = english ? template.nameEn : template.name;
  const customTitle =
    Boolean(draft.title.trim()) &&
    (scenarioChanged || (draft.title !== template.name && draft.title !== template.nameEn));
  const promptName = customTitle ? draft.title : adapt(templateName);
  const deliverable =
    chosenFormat && rawDeliverable.trim().toUpperCase() !== chosenFormat
      ? `${rawDeliverable} (${chosenFormat})`
      : rawDeliverable;
  const audience = nonBlankOr(
    draft.audience,
    english ? template.defaultAudienceEn : template.defaultAudience,
  );
  const rawPurpose = nonBlankOr(draft.purpose, english ? template.summaryEn : template.summary);
  const purpose =
    rawPurpose === template.summary || rawPurpose === template.summaryEn
      ? adapt(rawPurpose)
      : rawPurpose;
  const renderedDetails = [
    ...(!scenarioChanged
      ? [
          adapt(plan.inputs[language]),
          adapt(plan.focus[language]),
          adapt(plan.output[language]),
          adapt(plan.risk[language]),
        ]
      : []),
    ...(playbook
      ? [
          adapt(playbook.inputs[language]),
          adapt(playbook.method[language]),
          ...(!formatChanged ? [playbook.design[language]] : []),
          adapt(playbook.checks[language]),
        ]
      : []),
  ];
  const ruleKey = (value: string) =>
    value
      .trim()
      .replace(/[。.!?；;]+$/u, "")
      .trim();
  const represented = new Set(
    renderedDetails
      .flatMap((value) => value.split(/(?<=[。！？；])|(?<=[.!?;])\s+/u))
      .map(ruleKey)
      .filter(Boolean),
  );
  const uniqueRules = (items: string[]) =>
    items.filter((item) => {
      const key = ruleKey(item);
      if (!key || represented.has(key)) return false;
      represented.add(key);
      return true;
    });
  const workflowItems = (english ? template.workflowEn : template.workflow)
    .filter((item) => !formatChanged || !item.toUpperCase().includes(template.format))
    .map(adapt);
  const acceptanceItems = (english ? template.acceptanceEn : template.acceptance)
    .slice(0, scenarioChanged ? -2 : undefined)
    .map(adapt);
  const workflow = uniqueRules(workflowItems)
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n");
  const acceptance = uniqueRules(acceptanceItems)
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n");
  const skills = creativeSkillsForDraft(template, draft)
    .map((skill) =>
      english
        ? `- ${skill.id} (${skill.nameEn}): ${skill.reasonEn}`
        : `- ${skill.id}（${skill.name}）：${skill.reason}`,
    )
    .join("\n");
  if (english) {
    return [
      chosenFormat
        ? `Execute the Mingshen workstation workflow: ${promptName}. Produce a real ${deliverable} deliverable.`
        : `Execute the Mingshen workstation workflow: ${promptName}. First confirm whether available tools support ${deliverable}; if not, disclose the limitation and propose a supported alternative.`,
      workspacePath ? `Workspace: ${workspacePath}` : "Use the active WorkAgent workspace.",
      "WORK REQUEST",
      `Subject: ${nonBlankOr(draft.subject, "Identify a concrete subject from the available evidence and state missing information.")}`,
      `Audience: ${audience}`,
      `Purpose: ${purpose}`,
      `Source materials: ${nonBlankOr(draft.sourceMaterials, "Use authorized evidence and identify gaps.")}`,
      `Deliverable: ${deliverable}`,
      `Style: ${draftStylePrompt(template, draft, locale)}`,
      `Constraints: ${nonBlankOr(draft.constraints, "Distinguish facts and assumptions.")}`,
      ...(formatChanged
        ? [
            `The template originally targets ${template.format}. Adapt its business requirements and checks to ${deliverable}; do not claim unavailable native features or create an additional original-format file unless requested.`,
          ]
        : []),
      "CONTENT STRUCTURE",
      sectionPrompt(draft, template, locale, false),
      "PROFESSIONAL WORKFLOW",
      workflow,
      "ACCEPTANCE CRITERIA",
      acceptance,
      "DETAILED SCENARIO PLAYBOOK",
      ...(!scenarioChanged
        ? [
            `Evidence and fields: ${adapt(plan.inputs[language])}`,
            `Task method and decisions: ${adapt(plan.focus[language])}`,
            `Expected work products: ${adapt(plan.output[language])}`,
            `Specific review and risks: ${adapt(plan.risk[language])}`,
          ]
        : [
            "The original scenario section was changed or removed. Respect the edited draft rather than restoring the old scenario.",
          ]),
      ...(playbook
        ? [
            `Source preparation: ${adapt(playbook.inputs.en)}`,
            `Domain method: ${adapt(playbook.method.en)}`,
            ...(!formatChanged ? [`Structure and layout: ${playbook.design.en}`] : []),
            `Domain checks${formatChanged ? " (adapt to the selected format and actual evidence)" : ""}: ${adapt(playbook.checks.en)}`,
          ]
        : []),
      ...(formatGuide
        ? [`FORMAT-SPECIFIC AUTHORING: ${formatGuide.en}`]
        : [
            "Apply the requested format only if an available tool actually supports it; otherwise disclose the limitation and propose a supported alternative.",
          ]),
      "RECOMMENDED SKILLS",
      "Use relevant skills through use_skill with the exact name, subject to existing permissions. Do not bypass denial.",
      skills,
      "EXECUTION RULES",
      "Verify sources and permissions; separate facts, assumptions, and unapproved decisions. Use read_document on existing inputs and office_document or another available tool for the supported deliverable. Never invent sources, figures or approvals. Inspect the actual artifact, structure, recalculation and rendering separately; optional Office COM requires an existing installation and permission. Mark unavailable or partial checks unverified. Report the output path, decisions, performed checks and open items.",
    ].join("\n\n");
  }
  return [
    chosenFormat
      ? `你正在执行 Mingshen 工作站的「${promptName}」工作流，请制作真实的 ${deliverable} 交付物。`
      : `你正在执行 Mingshen 工作站的「${promptName}」工作流，请先核实工具是否支持 ${deliverable}；不支持时说明限制并提出可用替代。`,
    workspacePath ? `工作目录：${workspacePath}` : "使用当前 WorkAgent 会话的工作目录。",
    "【工作请求】",
    `主题：${nonBlankOr(draft.subject, "根据现有资料提炼具体主题并标明缺口。")}`,
    `受众：${audience}`,
    `目的：${purpose}`,
    `资料：${nonBlankOr(draft.sourceMaterials, "使用获授权的资料并标明缺口。")}`,
    `交付格式：${deliverable}`,
    `风格：${draftStylePrompt(template, draft, locale)}`,
    `约束：${nonBlankOr(draft.constraints, "区分事实与假设。")}`,
    ...(formatChanged
      ? [
          `模板建议格式为 ${template.format}，当前用户要求 ${deliverable}。保留业务目的并按所选格式调整内容和检查；不得假称原生能力，也不另行生成原格式文件，除非用户明确要求。`,
        ]
      : []),
    "【内容结构】",
    sectionPrompt(draft, template, locale, false),
    "【专业工作流】",
    workflow,
    "【验收标准】",
    acceptance,
    "【详细场景工作说明】",
    ...(!scenarioChanged
      ? [
          `场景资料与字段：${adapt(plan.inputs[language])}`,
          `核心处理方法与判断：${adapt(plan.focus[language])}`,
          `本场景成果：${adapt(plan.output[language])}`,
          `重点风险及复核：${adapt(plan.risk[language])}`,
        ]
      : ["当前草稿已修改或移除原场景章节。尊重用户现有章节和标题，不恢复原场景的要求或验收结论。"]),
    ...(playbook
      ? [
          `专业资料准备：${adapt(playbook.inputs.zh)}`,
          `专业处理方法：${adapt(playbook.method.zh)}`,
          ...(!formatChanged ? [`交付结构与版式：${playbook.design.zh}`] : []),
          `专业检查重点${formatChanged ? "（根据所选格式和实际证据适用）" : ""}：${adapt(playbook.checks.zh)}`,
        ]
      : []),
    ...(formatGuide
      ? [`【格式专精】${formatGuide.zh}`]
      : [
          "【格式专精】仅在实际工具支持时制作所选格式；不支持时说明限制并提出可用替代，不冒称已生成原生文件。",
        ]),
    "【建议引用的内置技能】",
    "在现有权限内通过 use_skill 的 name 参数按需调用相关技能，不得绕过拒绝。",
    skills,
    "【执行规则】",
    "核对来源与授权，区分事实、假设和未决事项，不编造数字或审批。既有文件用 read_document，成品用 office_document 或可用工具制作。分别检查实际文件结构、重算和渲染；Office COM 仅在已安装且权限允许时使用，不自动安装。不可用或不完整的检查标记未验证。最终列出交付路径、关键判断、实际检查和待办。",
  ].join("\n\n");
}

export function buildCreativeTemplatePrompt(
  template: CreativeTemplate,
  draft: CreativeWorkspaceDraft,
  locale: "zh-CN" | "en" = "zh-CN",
  workspacePath: string | null = null,
): string {
  const english = locale === "en";
  const scenarioId = `variant-${template.variantId}`;
  const scenarioSection = template.sections.find((section) => section.id === scenarioId);
  const draftScenarioSection = draft.sections.find((section) => section.id === scenarioId);
  const scenarioChanged =
    !scenarioSection ||
    !draftScenarioSection ||
    (draftScenarioSection.title !== scenarioSection.title &&
      draftScenarioSection.title !== scenarioSection.titleEn);
  if (draft.promptMode === "detailed") {
    return detailedPrompt(template, draft, locale, workspacePath, scenarioChanged);
  }
  const adapt = (value: string) => adaptTemplateText(value, template, draft, locale);
  const templateName = english ? template.nameEn : template.name;
  const customTitle =
    Boolean(draft.title.trim()) &&
    (scenarioChanged || (draft.title !== template.name && draft.title !== template.nameEn));
  const promptName = customTitle ? draft.title : adapt(templateName);
  const rawDeliverable = nonBlankOr(draft.deliverable, template.format);
  const requestedFormat = parseCreativeDeliverableFormat(rawDeliverable);
  const formatChanged = requestedFormat !== template.format;
  const deliverableLabel =
    requestedFormat && rawDeliverable.trim().toUpperCase() !== requestedFormat
      ? `${rawDeliverable} (${requestedFormat})`
      : rawDeliverable;
  const appliesToFormat = (item: string) =>
    !formatChanged || !item.toUpperCase().includes(template.format);
  const acceptance = (english ? template.acceptanceEn : template.acceptance)
    .slice(0, scenarioChanged ? -2 : undefined)
    .map((item, index) => `${index + 1}. ${adapt(item)}`)
    .join("\n");
  const workflow = (english ? template.workflowEn : template.workflow)
    .filter(appliesToFormat)
    .map((item, index) => `${index + 1}. ${adapt(item)}`)
    .join("\n");
  const audience = nonBlankOr(
    draft.audience,
    english ? template.defaultAudienceEn : template.defaultAudience,
  );
  const rawPurpose = nonBlankOr(draft.purpose, english ? template.summaryEn : template.summary);
  const purpose =
    rawPurpose === template.summary || rawPurpose === template.summaryEn
      ? adapt(rawPurpose)
      : rawPurpose;
  if (english) {
    return [
      `You are executing the selected Mingshen workstation workflow: ${promptName}.`,
      requestedFormat
        ? `Create a real, reusable ${deliverableLabel} deliverable in the active WorkAgent workspace. Do not stop at an outline or a chat-only answer.`
        : `First confirm whether available tools support ${deliverableLabel}; if not, disclose the limitation and propose a supported alternative.`,
      workspacePath
        ? `Workspace: ${workspacePath}`
        : "Use the active WorkAgent workspace; no path was passed to this view.",
      "",
      "WORK REQUEST",
      `Subject: ${nonBlankOr(draft.subject, "Derive a concrete subject from the supplied materials and state what is missing.")}`,
      `Audience: ${audience}`,
      `Purpose: ${purpose}`,
      `Source materials: ${nonBlankOr(draft.sourceMaterials, "Use only evidence in the active workspace and identify gaps.")}`,
      `Deliverable: ${deliverableLabel}`,
      ...(formatChanged
        ? [
            `The template originally targets ${template.format}, but the requested deliverable is ${draft.deliverable}. Adapt its business content and checks to the requested format. Treat original-format-specific native features, layouts, and files as references only; do not claim they exist in the selected format or create an additional original-format artifact unless explicitly requested.`,
          ]
        : []),
      `Style: ${draftStylePrompt(template, draft, locale)}`,
      `Constraints: ${nonBlankOr(draft.constraints, "Preserve factual accuracy and distinguish assumptions from recommendations.")}`,
      "",
      "CONTENT STRUCTURE",
      sectionPrompt(draft, template, locale),
      "",
      "PROFESSIONAL WORKFLOW",
      workflow,
      "",
      "ACCEPTANCE CRITERIA",
      acceptance,
      "",
      "EXECUTION RULES",
      "- Inspect relevant workspace files and supplied documents before writing. Use read_document for existing Office/PDF inputs.",
      "- Separate facts, assumptions, recommendations, and unresolved questions. Never invent sources, figures, approvals, or verification results.",
      "- Produce the final deliverable with office_document or the appropriate document tool at a clear, safe workspace path.",
      "- Reopen DOCX, XLSX, and PPTX outputs and inspect structure, formulas, notes, overflow, clipping, contrast, and page density. For PDF or HTML, render the final artifact and inspect page size, overflow, links, and responsive layout.",
      "- Use Office recalculation or rendering when available. If unavailable, label it unverified instead of claiming success.",
      "- Finish with the output path, key decisions, verification performed, and unresolved items.",
    ].join("\n");
  }
  return [
    `你正在执行 Mingshen 工作站中选定的「${promptName}」工作流。`,
    requestedFormat
      ? `请在当前 WorkAgent 工作区制作真实${requestedFormat === "PDF" ? "" : "、可继续编辑"}的 ${deliverableLabel} 交付物，不要只给提纲或聊天说明。`
      : `请先核实可用工具是否支持 ${deliverableLabel}；不支持时说明限制并提出可用替代，不得假称已生成。`,
    workspacePath
      ? `工作目录：${workspacePath}`
      : "请使用当前 WorkAgent 会话的实际工作目录；当前视图没有传入路径。",
    "",
    "【工作请求】",
    `主题：${nonBlankOr(draft.subject, "请根据已提供资料提炼一个具体主题，并在开始前标明仍缺失的信息。")}`,
    `受众：${audience}`,
    `目的：${purpose}`,
    `资料：${nonBlankOr(draft.sourceMaterials, "只使用当前工作区中可验证的资料，并明确说明缺口。")}`,
    `交付格式：${deliverableLabel}`,
    ...(formatChanged
      ? [
          `模板建议格式为 ${template.format}，当前用户要求 ${draft.deliverable}。保留业务目的并按所选格式调整内容和检查；原格式专属能力、版式和文件仅作参考，不应假称所选格式具备这些原生功能，也不另行生成原格式文件，除非用户明确要求。`,
        ]
      : []),
    `风格：${draftStylePrompt(template, draft, locale)}`,
    `约束：${nonBlankOr(draft.constraints, "保持事实准确，明确区分建议与假设。")}`,
    "",
    "【内容结构】",
    sectionPrompt(draft, template, locale),
    "",
    "【专业工作流】",
    workflow,
    "",
    "【验收标准】",
    acceptance,
    "",
    "【执行规则】",
    "- 先检查相关仓库文件和输入文档；既有 Office/PDF 文件使用 read_document 读取。",
    "- 分开记录事实、假设、建议和未决问题；不得虚构来源、数字、审批或验证结果。",
    "- 使用 office_document 或对应文档工具生成最终文件，选择清晰文件名和安全工作区路径。",
    "- DOCX、XLSX、PPTX 生成后必须重新打开检查结构、公式、备注、溢出、裁切、对比度和页面密度。",
    "- PDF 或 HTML 必须渲染最终成品，检查页面尺寸、溢出、链接及响应式布局。",
    "- Office 可用时执行重算或渲染检查；不可用时明确标记“未验证”，不得声称已通过。",
    "- 最终回复列出：交付路径、关键判断、实际验证项和未决事项。",
  ].join("\n");
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length > max) return null;
  return value;
}

export function parseCreativeWorkspaceDraft(value: unknown): CreativeWorkspaceDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (
    record.promptMode !== undefined &&
    record.promptMode !== "brief" &&
    record.promptMode !== "detailed"
  )
    return null;
  const templateId = boundedString(record.templateId, 160);
  if (!templateId || !findCreativeTemplate(templateId)) return null;
  const title = boundedString(record.title, 200);
  const subject = boundedString(record.subject, 2_000);
  const audience = boundedString(record.audience, 1_000);
  const purpose = boundedString(record.purpose, 3_000);
  const sourceMaterials = boundedString(record.sourceMaterials, 12_000);
  const deliverable = boundedString(record.deliverable, 300);
  const style = boundedString(record.style, 1_000);
  const constraints = boundedString(record.constraints, 3_000);
  if (
    title === null ||
    subject === null ||
    audience === null ||
    purpose === null ||
    sourceMaterials === null ||
    deliverable === null ||
    style === null ||
    constraints === null ||
    !Array.isArray(record.sections) ||
    record.sections.length < 1 ||
    record.sections.length > 30
  )
    return null;
  const sections: CreativeDraftSection[] = [];
  const sectionIds = new Set<string>();
  for (const [index, item] of record.sections.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const section = item as Record<string, unknown>;
    const id = boundedString(section.id, 160) || `custom-${index + 1}`;
    const sectionTitle = boundedString(section.title, 200);
    const notes = boundedString(section.notes, 8_000);
    if (sectionTitle === null || notes === null || !id.trim() || sectionIds.has(id)) return null;
    sectionIds.add(id);
    sections.push({ id, title: sectionTitle, notes });
  }
  return {
    version: 1,
    ...(record.promptMode === undefined ? {} : { promptMode: record.promptMode }),
    templateId,
    title,
    subject,
    audience,
    purpose,
    sourceMaterials,
    deliverable,
    style,
    constraints,
    sections,
    updatedAt: boundedString(record.updatedAt, 80) || new Date().toISOString(),
  };
}
