import type { CreativeAuthoredScenario, CreativeTranslation } from "./creative-template-authoring";
import { LEGACY_SCENARIO_GUIDES } from "./creative-template-legacy-cases";
import { LEGACY_SCENARIO_GUIDES_EN_C } from "./creative-template-legacy-en-c";

type Pair = CreativeTranslation;
type Detail = Pick<CreativeAuthoredScenario, "inputs" | "focus" | "output" | "risk">;
type Row = readonly [Pair, Pair, Pair, Pair];
type Context = Detail;

function cases(id: string, context: Context, rows: readonly Row[]): readonly Detail[] {
  const zh = LEGACY_SCENARIO_GUIDES[id];
  const en = LEGACY_SCENARIO_GUIDES_EN_C[id];
  if (!zh || !en || zh.length !== rows.length || en.length !== rows.length) {
    throw new Error(`Mismatched legacy creative details: ${id}`);
  }
  return rows.map(([inputs, focus, output, risk], index) => {
    const zhGuide = zh[index];
    const enGuide = en[index];
    if (!zhGuide || !enGuide) {
      throw new Error(`Missing legacy creative guide: ${id} at ${index}`);
    }
    return {
      inputs: [
        `${zhGuide[0]}。${inputs[0]}。${context.inputs[0]}`,
        `${enGuide[0]}. ${inputs[1]}. ${context.inputs[1]}`,
      ],
      focus: [
        `${zhGuide[1]}。${focus[0]}。${context.focus[0]}`,
        `${enGuide[1]}. ${focus[1]}. ${context.focus[1]}`,
      ],
      output: [`${output[0]}。${context.output[0]}`, `${output[1]}. ${context.output[1]}`],
      risk: [
        `${zhGuide[2]}。${risk[0]}。${context.risk[0]}`,
        `${enGuide[2]}. ${risk[1]}. ${context.risk[1]}`,
      ],
    };
  });
}

export const LEGACY_DETAILED_CASES_C: Readonly<Record<string, readonly Detail[]>> = {
  "business-case": cases(
    "business-case",
    {
      inputs: [
        "按投资期间、币种、价格基准和责任主体标明资料来源、版本及尚未获得的数据。",
        "Record period, currency, price basis, ownership, sources, versions, and missing inputs.",
      ],
      focus: [
        "比较同一基线与可执行替代方案，区分已签约现金流、估计收益和不可量化影响。",
        "Compare the same baseline with executable alternatives, separating committed cash flows, estimates, and qualitative effects.",
      ],
      output: [
        "明确决策人、资金时点、关键假设、复审日期以及需要进一步批准的条件。",
        "Identify the decision owner, funding timing, assumptions, review date, and conditions requiring approval.",
      ],
      risk: [
        "缺少真实数据时保留待确认状态，不能把估算、模型运行或评审草稿当作已批准投资。",
        "Mark missing data as unconfirmed; estimates and draft reviews do not constitute investment approval.",
      ],
    },
    [
      [
        [
          "取得分阶段资本支出、上线日期、现金回收及存量成本明细",
          "Obtain phased capital spending, launch date, cash receipts, and existing costs",
        ],
        [
          "计算相对不投资方案的年度净增现金流并列资金峰值",
          "Calculate annual incremental cash flow against no investment and identify peak funding",
        ],
        [
          "交付投资决策摘要、现金流分期表及阶段退出条件",
          "Deliver an investment summary, phased cash flow, and exit gates",
        ],
        [
          "区分沉没成本与新增成本，折现率未经批准不得伪定",
          "Separate sunk from incremental costs and do not invent an approved discount rate",
        ],
      ],
      [
        [
          "拆分目标区域客群、可服务容量、招聘节奏与场地投入",
          "Break down regional customers, service capacity, hiring, and facilities",
        ],
        [
          "比较一次扩张与分期进入的利用率和资金占用",
          "Compare utilization and funding for immediate versus phased expansion",
        ],
        [
          "交付区域对照、分期投资及人员缺口表",
          "Deliver regional comparisons, phased investment, and staffing gaps",
        ],
        [
          "未验证需求与供应能力不足应分别列风险",
          "List unvalidated demand and constrained capacity separately",
        ],
      ],
      [
        [
          "收集开发工时、产品单价、上市费用和用户留存假设",
          "Collect development effort, price, launch costs, and retention assumptions",
        ],
        [
          "按定价及采用率情景估算增量毛利并减去研发费用",
          "Estimate incremental margin by price and adoption scenario net of development",
        ],
        [
          "交付产品投资测算、情景敏感性及验证计划",
          "Deliver product economics, sensitivities, and validation plan",
        ],
        [
          "预测销量不能作为已签订单或已实现收入",
          "Forecast sales are not signed orders or realized revenue",
        ],
      ],
      [
        [
          "列目标地区准入条件、试点样本、渠道成本和获客周期",
          "List regional entry requirements, pilot sample, channel costs, and acquisition cycle",
        ],
        [
          "比较渠道伙伴和直接进入的时间、成本与撤出路径",
          "Compare partner and direct entry by timing, cost, and exit path",
        ],
        [
          "交付市场进入选项表、试点门槛和成本清单",
          "Deliver entry options, pilot gates, and cost breakdown",
        ],
        [
          "法规需要本地专业复核，市场总量不能直接当可得份额",
          "Obtain local regulatory review and do not equate total market with attainable share",
        ],
      ],
      [
        [
          "记录年交易量、处理工时、错误重工及系统订阅报价",
          "Record annual volume, processing hours, rework, and subscription quotes",
        ],
        [
          "将可释放工时、实施投入和年度维护分别计算",
          "Calculate released hours, implementation, and annual maintenance separately",
        ],
        [
          "交付流程自动化成本收益表及人工复核点",
          "Deliver automation economics and human-review checkpoints",
        ],
        [
          "节省时间需验证可转化方式，异常处理不能按零成本",
          "Validate how time savings are realized and include exception handling",
        ],
      ],
      [
        [
          "收集设备故障次数、剩余寿命、备件、停机损失和报价",
          "Collect failures, remaining life, spares, downtime loss, and quotes",
        ],
        [
          "按同一使用期比较维修、替换和租赁的总成本",
          "Compare repair, replacement, and lease over the same useful period",
        ],
        [
          "交付设备成本对照、停机安排和资产处置说明",
          "Deliver equipment cost comparison, downtime plan, and disposal assumptions",
        ],
        [
          "残值、安全合规和停产窗口未确认时不作确定结论",
          "Leave residual value, safety compliance, and downtime windows unconfirmed",
        ],
      ],
      [
        [
          "提供许可证、故障处理、集成改造和培训费用记录",
          "Provide license, incident, integration, and training costs",
        ],
        [
          "对照维持原系统与分阶段升级的长期支出和服务风险",
          "Compare long-term spending and service risk for retention versus phased upgrade",
        ],
        [
          "交付升级费用桥、迁移依赖和回退条件",
          "Deliver an upgrade cost bridge, migration dependencies, and rollback conditions",
        ],
        [
          "保留旧版兼容与数据恢复成本，不假设升级无中断",
          "Include compatibility and recovery costs; do not assume uninterrupted upgrade",
        ],
      ],
      [
        [
          "收集内部人员成本、供应商报价、服务量和交接费用",
          "Collect internal staffing costs, supplier bids, service volumes, and transition costs",
        ],
        [
          "比较自营与外包在同等服务等级下的全生命周期成本",
          "Compare in-house and outsourced lifecycle costs at equivalent service levels",
        ],
        [
          "交付范围对照、成本模型与退出安排清单",
          "Deliver scope comparison, cost model, and exit arrangements",
        ],
        [
          "区分一次性切换费用、供应商违约和数据回收责任",
          "Separate transition costs, supplier failure, and data return responsibilities",
        ],
      ],
      [
        [
          "提供试点覆盖人数、样本构成、效果口径及复制成本",
          "Provide pilot participation, sample makeup, outcome definitions, and scaling cost",
        ],
        [
          "以事前门槛比较试点结果并分批安排扩展",
          "Compare pilot outcomes with pre-agreed gates and plan phased expansion",
        ],
        [
          "交付试点结果证据、扩展条件和停止信号",
          "Deliver pilot evidence, expansion conditions, and stop signals",
        ],
        [
          "样本不具代表性或效果未重复时禁止全量外推",
          "Do not extrapolate unrepresentative or unrepeated outcomes",
        ],
      ],
      [
        [
          "列产线瓶颈、订单需求分布、交付周期与新增设备报价",
          "List bottlenecks, order distribution, lead times, and equipment quotes",
        ],
        [
          "比较增购、加班和外包对瓶颈及交期的影响",
          "Compare equipment, overtime, and outsourcing impacts on bottlenecks and lead time",
        ],
        [
          "提供产能负荷表、需求敏感性和采购决策点",
          "Provide capacity load, demand sensitivities, and purchase decision points",
        ],
        [
          "平均利用率可能掩盖高峰瓶颈及维护停机",
          "Average utilization can hide peak bottlenecks and maintenance downtime",
        ],
      ],
      [
        [
          "对照原新供应商交期、物流路线、安全库存和合同期限",
          "Compare supplier lead times, routes, safety stock, and contract terms",
        ],
        [
          "量化切换期并行运行、库存占用和断供影响",
          "Quantify parallel operation, inventory, and supply-interruption effects",
        ],
        [
          "交付供应链对照、切换计划和连续性措施",
          "Deliver supply-chain comparison, transition plan, and continuity measures",
        ],
        [
          "未批准的合同变更和单一来源依赖需升级",
          "Escalate unapproved contract changes and single-source dependency",
        ],
      ],
      [
        [
          "收集各方投入、收入分配、知识产权及退出协议草案",
          "Collect each party's contribution, revenue allocation, IP, and draft exit terms",
        ],
        [
          "核算双方新增投入和可归属收益并比较各自基线",
          "Calculate each party's incremental costs and attributable benefits against baseline",
        ],
        [
          "输出合作价值分配、责任边界和待签条款",
          "Output value allocation, responsibility boundaries, and unsigned terms",
        ],
        [
          "协议未签署前不能把收益分配或独占权当既定事实",
          "Do not treat unsigned revenue allocation or exclusivity as settled",
        ],
      ],
    ],
  ),
  "product-spec": cases(
    "product-spec",
    {
      inputs: [
        "记录角色、设备、版本、业务规则和可复核的用户证据，遗漏的权限或数据来源明确待补。",
        "Record roles, devices, versions, business rules, and user evidence; flag missing permissions or data sources.",
      ],
      focus: [
        "按触发、前置条件、主流程、替代路径和状态转换写出可测试行为与决策边界。",
        "Specify testable behavior and decisions through triggers, prerequisites, main flow, alternatives, and states.",
      ],
      output: [
        "为产品、设计、工程与测试明确范围、责任人、可观察验收结果和未决问题。",
        "Give product, design, engineering, and QA clear scope, ownership, observable acceptance, and open questions.",
      ],
      risk: [
        "不能将拟议功能写成已经实现，也不得用成功状态掩盖失败、权限拒绝或数据丢失。",
        "Do not present proposed behavior as implemented or hide failure, denied access, or data loss.",
      ],
    },
    [
      [
        [
          "明确目标任务、用户角色、触发入口及现有研究证据",
          "Identify target tasks, user roles, entry points, and research",
        ],
        [
          "从用户动作展开空态、加载、成功和失败状态",
          "Expand user actions into empty, loading, success, and failure states",
        ],
        [
          "提供需求条目、状态表及逐条验收示例",
          "Provide requirements, state table, and acceptance examples",
        ],
        ["未确认优先级与范围外事项需单列", "List unconfirmed priorities and exclusions"],
      ],
      [
        [
          "收集原功能使用量、失败记录、用户反馈与兼容约束",
          "Collect usage, failures, feedback, and compatibility constraints",
        ],
        [
          "比较现状与目标行为并保留旧数据处理路径",
          "Compare current and target behavior and preserve legacy-data handling",
        ],
        [
          "交付改进前后对照、迁移影响及回归用例",
          "Deliver before-and-after comparison, migration impact, and regression cases",
        ],
        [
          "不要把方案偏好误认成已验证痛点",
          "Do not mistake solution preference for a validated problem",
        ],
      ],
      [
        [
          "提供原步骤、耗时、流失位置及任务完成证据",
          "Provide existing steps, duration, abandonment points, and completion evidence",
        ],
        [
          "比较减少步骤对权限、校验和恢复行为的影响",
          "Compare how fewer steps affect permissions, validation, and recovery",
        ],
        [
          "提供新旧流程、关键节点及中断恢复规格",
          "Provide old and new flows, key nodes, and interrupted-task recovery",
        ],
        [
          "优化不得移除必要确认或降低可访问性",
          "Do not remove required confirmation or reduce accessibility",
        ],
      ],
      [
        [
          "列服务入口、可申请事项、角色授权及人工支持渠道",
          "List service entries, requests, role permissions, and human support",
        ],
        [
          "定义自助提交、进度查询、失败转人工和取消",
          "Define self-service submission, status, human escalation, and cancellation",
        ],
        [
          "交付服务目录、权限矩阵与异常处理流程",
          "Deliver service catalog, permission matrix, and exception flows",
        ],
        [
          "不可访问的数据不能凭隐藏按钮当成受保护",
          "A hidden button does not protect inaccessible data",
        ],
      ],
      [
        [
          "记录触发事件、接收对象、通知渠道、频率和偏好",
          "Record trigger events, recipients, channels, frequency, and preferences",
        ],
        [
          "定义合并去重、退订、生效时间与发送失败处理",
          "Define batching, deduplication, opt-out, timing, and delivery failures",
        ],
        [
          "交付事件到消息映射、状态规则及测试样例",
          "Deliver event-message mapping, state rules, and test cases",
        ],
        [
          "敏感正文与未授权渠道必须禁止发送",
          "Prevent sensitive content or delivery to unauthorized channels",
        ],
      ],
      [
        [
          "列账户字段、身份验证方式、设备和敏感设置",
          "List account fields, authentication methods, devices, and sensitive settings",
        ],
        [
          "描述编辑验证、再次认证、保存冲突及恢复",
          "Describe edit validation, reauthentication, save conflicts, and recovery",
        ],
        [
          "交付设置字段表、操作流程及安全验收",
          "Deliver settings fields, operation flows, and security acceptance",
        ],
        ["不得在提示文稿或日志中保留凭据", "Do not retain credentials in prompts or logs"],
      ],
      [
        [
          "列输入格式、字段映射、主键、容量限制和错误文件",
          "List formats, field mappings, keys, limits, and error samples",
        ],
        [
          "按预览、逐行校验、确认导入和失败恢复设计流程",
          "Design preview, row validation, confirmation, and failure recovery",
        ],
        [
          "输出映射规范、错误行报告及重复导入策略",
          "Output mapping specification, row-error report, and repeat-import policy",
        ],
        [
          "禁止静默丢行、覆盖原数据或伪报全部成功",
          "Prevent silent row loss, overwrites, and false success",
        ],
      ],
      [
        [
          "提供申请类型、审批层级、授权期限和例外规则",
          "Provide request types, approval levels, authorization periods, and exceptions",
        ],
        [
          "定义提交、撤回、转派、拒绝及迟到审批状态",
          "Define submit, withdraw, delegate, reject, and late-approval states",
        ],
        [
          "交付状态机、权限表及审计字段",
          "Deliver a state machine, permission table, and audit fields",
        ],
        [
          "审批授权变化及重复操作必须有可追溯结果",
          "Make authorization changes and duplicate actions traceable",
        ],
      ],
      [
        [
          "盘点旧功能人群、依赖接口及替代功能缺口",
          "Inventory legacy users, dependent interfaces, and replacement gaps",
        ],
        [
          "设计并行期、切换提示、迁移支持和恢复旧版条件",
          "Design parallel operation, cutover notices, support, and rollback conditions",
        ],
        [
          "交付替换矩阵、用户迁移步骤和退出门槛",
          "Deliver replacement matrix, user migration steps, and exit criteria",
        ],
        [
          "无替代能力的用户不得默认已迁移",
          "Do not assume users without a replacement have migrated",
        ],
      ],
      [
        [
          "列版本号、数据结构、兼容系统和失败样本",
          "List versions, data formats, compatible systems, and failure cases",
        ],
        [
          "设计升级前检查、转换验证及失败后恢复",
          "Design pre-upgrade checks, conversion validation, and failure recovery",
        ],
        [
          "提供迁移兼容表、验证项和备份保留要求",
          "Provide compatibility matrix, checks, and backup retention",
        ],
        [
          "禁止不经备份覆盖用户数据或夸大兼容范围",
          "Do not overwrite data without backup or overstate compatibility",
        ],
      ],
      [
        [
          "确认试点名单、纳入条件、任务范围、观察周期、基线指标及支持联系人",
          "Confirm the pilot cohort, eligibility, task scope, observation period, baseline metrics, and support contacts",
        ],
        [
          "设计资格筛选、反馈收集和异常升级，并明确停止与扩围所需的证据和决策人",
          "Design eligibility, feedback, and escalation; specify the evidence and decision owner for stopping or expanding",
        ],
        [
          "交付试点边界、观察计划、结果记录及参与者退出和数据处理说明",
          "Deliver pilot boundaries, an observation plan, results record, and guidance on participant exit and data handling",
        ],
        [
          "样本偏差或观察不足时不能推断所有用户适用，扩围须由授权人决定",
          "Do not generalize biased or insufficient pilot observations to all users; expansion requires an authorized decision",
        ],
      ],
      [
        [
          "整理旧入口、依赖方、数据导出和合同期限",
          "Inventory old entries, dependents, exports, and contract deadlines",
        ],
        [
          "按通知、替代、导出和终止顺序安排退役",
          "Order retirement as notice, alternatives, export, and shutdown",
        ],
        [
          "输出退役时间表、迁移检查和支持路径",
          "Output retirement schedule, migration checks, and support path",
        ],
        [
          "确认未迁移客户及法定保留要求后再建议终止",
          "Check unmigrated customers and retention duties before recommending shutdown",
        ],
      ],
    ],
  ),
  "ux-research": cases(
    "ux-research",
    {
      inputs: [
        "记录研究问题、招募标准、同意方式、样本及原始观察的来源与版本，不制造受访数据。",
        "Record research questions, recruitment, consent, sample, and source versions without inventing observations.",
      ],
      focus: [
        "围绕实际任务分析证据并保留反例，分开受访者原话、观察结果与研究者推断。",
        "Analyze evidence around real tasks and retain counterexamples, separating quotations, observations, and inference.",
      ],
      output: [
        "标注方法、样本范围、证据位置、研究限制和负责后续验证的角色与时间。",
        "State method, sample, evidence location, limitations, and ownership and timing for follow-up.",
      ],
      risk: [
        "按授权处理识别信息；小样本或未经验证的假设不得表述为总体规律或确定因果。",
        "Handle identifying information within consent; small samples and hypotheses do not establish population patterns or causation.",
      ],
    },
    [
      [
        [
          "列业务决策、目标群体、未知任务及既有证据空缺",
          "List business decisions, target groups, unknown tasks, and evidence gaps",
        ],
        [
          "先询问真实任务与替代做法，再归纳待验证需求",
          "Ask about real tasks and alternatives before framing needs to validate",
        ],
        [
          "交付探索提纲、证据地图和后续招募条件",
          "Deliver an exploratory guide, evidence map, and recruitment criteria",
        ],
        [
          "预设功能偏好不能替代真实问题证据",
          "A preferred feature is not evidence of an actual problem",
        ],
      ],
      [
        [
          "记录招募配额、访谈时间、许可范围及问题提纲",
          "Record recruitment quotas, interview timing, consent, and discussion guide",
        ],
        [
          "用开放追问收集事例并逐条标注受访者原话",
          "Use open follow-ups for examples and attribute verbatim statements",
        ],
        [
          "交付脱敏访谈摘要、主题与代表性引文",
          "Deliver anonymized summaries, themes, and representative quotations",
        ],
        [
          "匿名化不等于绝对无法重新识别",
          "Anonymization does not guarantee reidentification is impossible",
        ],
      ],
      [
        [
          "列观察任务、工作环境、操作者角色和记录许可",
          "List observed tasks, work context, roles, and recording authorization",
        ],
        [
          "按发生顺序记录步骤、阻塞与实际替代操作",
          "Record actions, blockers, and workarounds in occurrence order",
        ],
        [
          "提供观察记录、步骤时间线及待验证问题",
          "Provide observation records, task timelines, and questions to validate",
        ],
        [
          "观察者提示须单独标记，避免改变任务结果",
          "Mark observer prompts separately to avoid distorting results",
        ],
      ],
      [
        [
          "记录地点、光线、噪声、设备和参与者工作约束",
          "Record location, light, noise, device, and participant constraints",
        ],
        [
          "比较不同环境对任务、中断与协作的影响",
          "Compare effects of context on tasks, interruptions, and collaboration",
        ],
        [
          "输出情境要素表、任务影响和设计机会",
          "Output contextual factors, task impacts, and design opportunities",
        ],
        [
          "环境图片可能包含敏感信息，须按授权脱敏",
          "Context images may reveal sensitive data and require authorized redaction",
        ],
      ],
      [
        [
          "列原型版本、场景任务、参与人数和成功定义",
          "List prototype version, scenario tasks, participant count, and success criteria",
        ],
        [
          "观察任务完成路径、误操作和原型缺失反馈",
          "Observe completion paths, mistakes, and unavailable prototype responses",
        ],
        [
          "交付逐任务结果、严重度和原型修订建议",
          "Deliver task results, severity, and prototype revision proposals",
        ],
        [
          "原型无法实现的交互不能计作真实产品缺陷",
          "Do not equate unimplemented prototype interactions with production defects",
        ],
      ],
      [
        [
          "收集现网步骤、任务脚本、帮助方式和招募范围",
          "Collect live workflow, task scripts, help methods, and recruitment scope",
        ],
        [
          "记录独立完成、提示后完成及中途退出各自数量",
          "Record independent completion, prompted completion, and abandonment separately",
        ],
        [
          "输出路径对照、失败位置及恢复行为",
          "Output path comparisons, failure points, and recovery behavior",
        ],
        ["提示后完成不得计入独立成功率", "Do not count prompted completion as independent success"],
      ],
      [
        [
          "提供栏目结构、标签名称、检索任务和内容样本",
          "Provide categories, labels, retrieval tasks, and content samples",
        ],
        [
          "观察分类位置、路径选择和任务找回结果",
          "Observe category placement, path choices, and retrieval outcomes",
        ],
        [
          "交付查找路径、误分类和标签改进清单",
          "Deliver retrieval paths, misclassifications, and label improvements",
        ],
        [
          "找不到结果必须保留，不能仅统计成功查找",
          "Retain failures rather than reporting only successful retrievals",
        ],
      ],
      [
        [
          "列设备型号、系统版本、网络条件和目标任务",
          "List devices, operating systems, network conditions, and target tasks",
        ],
        [
          "观察触控目标、键盘遮挡、网络变化与中断恢复",
          "Observe touch targets, keyboard occlusion, network changes, and recovery",
        ],
        [
          "输出设备条件、任务结果和移动端问题表",
          "Output device conditions, task outcomes, and mobile issue list",
        ],
        [
          "有限机型样本不能覆盖全部屏幕与网络条件",
          "A limited device sample cannot cover every screen and network",
        ],
      ],
      [
        [
          "整理旅程阶段、接触渠道、关键行为及负责团队",
          "Organize journey stages, channels, key behavior, and responsible teams",
        ],
        [
          "逐阶段连接用户证据、等待时间和跨部门交接",
          "Connect user evidence, wait times, and cross-team handoffs by stage",
        ],
        [
          "交付旅程表、证据引用和改善机会优先级",
          "Deliver journey map, evidence references, and prioritized opportunities",
        ],
        [
          "情绪曲线无直接证据时应标记为推测",
          "Label emotional curves as inference when direct evidence is absent",
        ],
      ],
      [
        [
          "确认流失口径、离开时间、接触渠道及访谈授权",
          "Confirm churn definition, departure time, contact channel, and consent",
        ],
        [
          "比较离开前经历、替代方案及待验证原因",
          "Compare pre-departure experiences, alternatives, and possible causes",
        ],
        [
          "输出流失路径、访谈主题和可检验假设",
          "Output departure paths, interview themes, and testable hypotheses",
        ],
        [
          "留存用户与未联系到的流失用户存在选择偏差",
          "Account for selection bias among retained and unreachable users",
        ],
      ],
      [
        [
          "列线上线下渠道、接触顺序及客户和员工反馈",
          "List online and offline channels, contact sequence, and customer and staff feedback",
        ],
        [
          "追踪跨渠道转接的信息重复、等待和责任中断",
          "Trace repeated information, waiting, and ownership gaps across channels",
        ],
        ["交付接触点对照及交接问题证据表", "Deliver touchpoint comparison and handoff evidence"],
        [
          "单渠道样本不足时不得推断全部服务体验",
          "Do not generalize a single-channel sample to the whole service",
        ],
      ],
      [
        [
          "整理首次访问、任务启动、激活记录和访谈样本",
          "Organize first visits, task starts, activation records, and interviews",
        ],
        [
          "按步骤区分无法完成、主动放弃和尚未尝试",
          "Distinguish inability, voluntary abandonment, and no attempt by step",
        ],
        [
          "输出采用漏斗、障碍证据和支持措施",
          "Output adoption funnel, barrier evidence, and support measures",
        ],
        ["缺失事件埋点不能按零用户处理", "Do not treat missing instrumentation as zero users"],
      ],
    ],
  ),
  "release-readiness": cases(
    "release-readiness",
    {
      inputs: [
        "记录候选版本标识、环境、变更范围、验证证据、责任人和批准状态，缺失测试单列。",
        "Record candidate version, environment, change scope, verification evidence, owners, and approvals; list missing tests.",
      ],
      focus: [
        "按发布前置条件、观察窗口、停止阈值、回退步骤和负责角色组织审查，不代替实际执行。",
        "Review prerequisites, observation windows, stop thresholds, rollback steps, and owners without substituting for execution.",
      ],
      output: [
        "列出实际已通过、未运行、失败和需人工确认项目，给出裁决责任与下次检查时间。",
        "List passed, unrun, failed, and pending checks with decision ownership and next review time.",
      ],
      risk: [
        "没有实际证据不能宣称测试通过、发布成功或回退可用，任何操作仍需授权和既有保护。",
        "Without evidence, do not claim tests passed, release succeeded, or rollback works; existing authorization and safeguards apply.",
      ],
    },
    [
      [
        [
          "列构建标识、变更清单、回归结果和发布窗口",
          "List build identity, changes, regression results, and release window",
        ],
        [
          "按阻塞缺陷、值守资源和验收证据逐项裁决",
          "Decide on blockers, on-call coverage, and acceptance evidence",
        ],
        [
          "交付发布检查表、风险登记与上线决议草稿",
          "Deliver a release checklist, risk register, and decision draft",
        ],
        [
          "跳过环境或测试需明确标注，不能推定全量通过",
          "Explicitly mark skipped environments and tests",
        ],
      ],
      [
        [
          "记录生产故障影响、补丁版本、目标环境及验证范围",
          "Record incident impact, patch version, target environment, and verification",
        ],
        [
          "压缩沟通链但保留关键回归、批准和恢复检查",
          "Shorten communication while retaining critical regression, approval, and recovery checks",
        ],
        [
          "提供紧急变更记录、未测风险和后续补测计划",
          "Provide an emergency change record, untested risks, and follow-up tests",
        ],
        [
          "紧急状态不能消除权限、备份或关键审批",
          "Urgency does not remove permissions, backups, or critical approvals",
        ],
      ],
      [
        [
          "列灰度人群、批次比例、监控指标与每批观察时长",
          "List rollout cohorts, percentages, metrics, and observation periods",
        ],
        [
          "依据阈值决定扩大、暂停或回退并记录责任人",
          "Use thresholds to expand, pause, or roll back with named owners",
        ],
        [
          "输出灰度批次表、阈值和人工裁决清单",
          "Output cohorts, thresholds, and human decision checklist",
        ],
        [
          "监控缺失或阈值未确认时不得自动扩大",
          "Do not expand automatically with missing monitoring or thresholds",
        ],
      ],
      [
        [
          "确认试点用户、支持人员、候选版本及反馈周期",
          "Confirm pilot users, support staff, candidate version, and feedback period",
        ],
        [
          "按试点任务、反馈和验收条件安排进入与退出",
          "Arrange entry and exit around tasks, feedback, and acceptance",
        ],
        [
          "交付试点发布计划、问题台账及扩展建议",
          "Deliver pilot release plan, issue register, and expansion recommendation",
        ],
        [
          "试点参与不代表所有用户已接受或正式上线",
          "Pilot participation does not imply universal acceptance or production launch",
        ],
      ],
      [
        [
          "列迁移脚本版本、备份点、停机窗口和兼容服务",
          "List migration script versions, backup points, downtime window, and compatible services",
        ],
        [
          "核查执行顺序、前后数据校验和恢复演练",
          "Check execution order, pre/post data validation, and recovery rehearsal",
        ],
        [
          "交付迁移核验表、恢复依赖及未演练事项",
          "Deliver migration checks, recovery dependencies, and unrehearsed items",
        ],
        ["备份存在不等于恢复已验证", "A backup existing does not prove recovery works"],
      ],
      [
        [
          "收集接口版本、调用方、兼容期和契约测试结果",
          "Collect API versions, callers, compatibility periods, and contract tests",
        ],
        [
          "识别破坏性字段变化并规划逐调用方迁移",
          "Identify breaking field changes and plan each caller's migration",
        ],
        [
          "输出兼容矩阵、通知计划及监控清单",
          "Output a compatibility matrix, notice plan, and monitoring list",
        ],
        ["未确认的调用方不能视为已迁移", "Do not assume unconfirmed callers have migrated"],
      ],
      [
        [
          "列基础设施清单、配置版本、依赖容量及维护窗口",
          "List infrastructure, configuration versions, dependency capacity, and maintenance window",
        ],
        [
          "审查变更顺序、容量余量、监控和恢复步骤",
          "Review change order, headroom, monitoring, and restoration",
        ],
        [
          "交付实施检查、回退决策点及值守安排",
          "Deliver implementation checks, rollback decision points, and on-call assignments",
        ],
        [
          "未知环境或未授权访问不得直接执行更改",
          "Do not change unknown environments or act without authorization",
        ],
      ],
      [
        [
          "对照配置键、生效环境、旧值与新值、适用范围、变更窗口和审批记录",
          "Compare configuration keys, environments, old and new values, scope, change window, and approvals",
        ],
        [
          "核验配置差异，明确分批生效条件、监控阈值、暂停责任人和撤销步骤",
          "Verify configuration differences and define phased activation conditions, monitoring thresholds, pause ownership, and reversal steps",
        ],
        [
          "输出脱敏差异表、版本与作用范围、人工生效检查及异常升级路径",
          "Output a redacted diff, version and scope, manual activation checks, and escalation path",
        ],
        [
          "密钥和敏感配置值不得进入报告，撤销步骤未经演练不得声称已验证",
          "Exclude secrets and sensitive values from the report; do not claim reversal is verified without a rehearsal",
        ],
      ],
      [
        [
          "列客户环境版本、升级窗口、联系人及迁移依赖",
          "List customer environment versions, upgrade windows, contacts, and dependencies",
        ],
        [
          "按兼容性分批并安排通知、备份和验收",
          "Group by compatibility and arrange notices, backup, and acceptance",
        ],
        [
          "交付升级批次、支持联系人和恢复方案",
          "Deliver upgrade cohorts, support contacts, and recovery plan",
        ],
        ["不能把待确认客户标成已升级", "Do not mark unconfirmed customers upgraded"],
      ],
      [
        [
          "记录默认值变更、受影响账号、关闭入口和支持材料",
          "Record default changes, affected accounts, opt-out entry, and support materials",
        ],
        [
          "定义分批启用、用户选择与行为观测",
          "Define staged enablement, user choice, and observation",
        ],
        [
          "输出默认变更说明、开关规则及回退检查",
          "Output default-change notice, toggle rules, and rollback checks",
        ],
        [
          "保留用户已有选择，避免默认值覆盖明确偏好",
          "Preserve existing user choices rather than overwriting explicit preferences",
        ],
      ],
      [
        [
          "列旧功能用户、替代入口、迁移数据及支持记录",
          "List legacy users, replacement entries, migration data, and support records",
        ],
        [
          "按客户核对迁移状态、问题解决和例外期限",
          "Check migration, issue resolution, and exceptions per customer",
        ],
        [
          "输出迁移状态表、逾期事项及支持安排",
          "Output migration statuses, overdue issues, and support arrangements",
        ],
        ["未收到客户反馈不等于迁移成功", "Missing customer feedback is not proof of migration"],
      ],
      [
        [
          "收集退役范围、依赖方、通知日期和数据导出期限",
          "Collect retirement scope, dependents, notice dates, and export deadlines",
        ],
        [
          "按通知、迁移、导出和停止服务分阶段核验",
          "Verify notice, migration, export, and shutdown in stages",
        ],
        [
          "交付退役门槛、未迁移依赖及应急方案",
          "Deliver retirement gates, unmigrated dependencies, and contingency plan",
        ],
        [
          "法定保留和合同通知义务未经审核不得忽略",
          "Do not disregard unreviewed retention and contractual notice obligations",
        ],
      ],
    ],
  ),
  "architecture-decision": cases(
    "architecture-decision",
    {
      inputs: [
        "描述现有系统边界、数据敏感级别、SLO、依赖、团队运维能力及约束来源和日期。",
        "Describe current boundaries, data sensitivity, SLOs, dependencies, and operator constraints with sources and dates.",
      ],
      focus: [
        "以相同工作负载和故障情境比较候选方案，展示取舍、逆转成本与需验证假设。",
        "Compare candidates under the same workloads and failures, showing tradeoffs, reversibility, and assumptions to validate.",
      ],
      output: [
        "记录决策状态、选项排除理由、责任人、实施门槛和复审触发器。",
        "Record decision status, rejected alternatives, owners, implementation gates, and review triggers.",
      ],
      risk: [
        "目标架构不是实测能力；禁止在决策材料写入秘密或未经授权的生产细节。",
        "A target architecture is not measured capability; exclude secrets and unauthorized production details.",
      ],
    },
    [
      [
        [
          "列业务能力、团队维护边界、上下游接口和峰值负载",
          "List capabilities, team ownership, upstream and downstream interfaces, and peak load",
        ],
        [
          "比较按业务域拆分与按技术层拆分的变更耦合",
          "Compare change coupling under domain-based and technical-layer boundaries",
        ],
        [
          "交付上下文图、责任映射和候选边界表",
          "Deliver a context map, ownership mapping, and boundary options",
        ],
        [
          "跨服务事务、数据归属不清会增加一致性故障",
          "Unclear cross-service transactions or data ownership increase consistency failures",
        ],
      ],
      [
        [
          "列实体规模、读写比例、一致性要求、保留及恢复目标",
          "List entity scale, read/write ratios, consistency, retention, and recovery goals",
        ],
        [
          "按访问模式比较关系型、键值和对象存储方案",
          "Compare relational, key-value, and object storage against access patterns",
        ],
        [
          "提供选型矩阵、迁移步骤、备份和恢复检查",
          "Provide a decision matrix, migration steps, backup, and recovery checks",
        ],
        [
          "成本模型需包含恢复演练、增长和退出迁移",
          "Include recovery drills, growth, and exit migration in cost analysis",
        ],
      ],
      [
        [
          "收集消息契约、延迟目标、峰值、重试方和数据敏感级别",
          "Collect message contracts, latency targets, peaks, retry owners, and sensitivity",
        ],
        [
          "比较同步调用、事件通知和批量交换的故障传播",
          "Compare synchronous, event, and batch integration failure propagation",
        ],
        [
          "交付接口边界、超时语义和版本演进规格",
          "Deliver interface boundaries, timeout semantics, and versioning rules",
        ],
        [
          "重试可能产生重复副作用，需定义幂等键和冲突处理",
          "Retries can duplicate effects; define idempotency keys and conflict handling",
        ],
      ],
      [
        [
          "记录任务到达率、最长等待、顺序要求及下游容量",
          "Record arrival rate, maximum wait, ordering, and consumer capacity",
        ],
        [
          "估算队列积压和消费速率并定义重试退避及死信处理",
          "Estimate backlog and throughput; define retry backoff and dead-letter handling",
        ],
        [
          "交付队列状态图、容量假设与告警阈值建议",
          "Deliver queue-state diagram, capacity assumptions, and alert thresholds",
        ],
        [
          "不可达消费者、毒消息和重复投递需单独演练",
          "Exercise unavailable consumers, poison messages, and duplicate delivery",
        ],
      ],
      [
        [
          "列身份源、主体类型、资源清单、权限请求和撤权路径",
          "List identity providers, principals, resources, access requests, and revocation",
        ],
        [
          "比较集中授权和资源本地授权的审计及撤销影响",
          "Compare audit and revocation effects of centralized and local authorization",
        ],
        [
          "形成角色映射、权限决策表和审计证据要求",
          "Create role mapping, authorization table, and audit evidence requirements",
        ],
        [
          "复核继承权限、离职撤权和机器身份轮换",
          "Review inherited access, offboarding revocation, and machine-identity rotation",
        ],
      ],
      [
        [
          "列灾难场景、RTO/RPO、备份副本位置和依赖故障",
          "List disaster scenarios, RTO/RPO, backup locations, and dependency failures",
        ],
        [
          "对比多区隔离、冷备恢复与服务级切换步骤",
          "Compare multi-zone isolation, cold recovery, and service failover",
        ],
        [
          "输出恢复依赖图、验证计划和未演练差距",
          "Output a recovery dependency map, test plan, and unrehearsed gaps",
        ],
        [
          "目标时限属于约定目标，不代表已有演练达成",
          "Target recovery times are goals, not proof of drill performance",
        ],
      ],
      [
        [
          "列核心业务指标、日志字段、追踪ID和告警责任人",
          "List core metrics, log fields, trace IDs, and alert owners",
        ],
        [
          "按故障调查问题设计关联维度、采样和告警分层",
          "Design correlation, sampling, and alert tiers around diagnostic questions",
        ],
        [
          "交付观测数据字典和典型故障查询路径",
          "Deliver an observability dictionary and example investigation paths",
        ],
        [
          "高基数与个人数据需设限，不能将日志写入凭据",
          "Limit high-cardinality and personal data; never log credentials",
        ],
      ],
      [
        [
          "列凭据类型、消费者身份、轮换频率、失效窗口及存储边界",
          "List credential types, consumers, rotation cadence, revocation window, and storage boundary",
        ],
        [
          "比较受管密钥服务、短期令牌与人工轮换流程",
          "Compare managed secret stores, short-lived tokens, and manual rotation",
        ],
        [
          "提供凭据生命周期、应急撤销和审计责任说明",
          "Provide credential lifecycle, emergency revocation, and audit ownership",
        ],
        [
          "材料使用合成占位值，真实秘密不得进入ADR",
          "Use synthetic placeholders; never place real secrets in an ADR",
        ],
      ],
      [
        [
          "记录候选框架准确版本、平台限制、团队技能和维护周期",
          "Record exact framework versions, platform limits, team skills, and maintenance horizon",
        ],
        [
          "按功能覆盖、生态依赖、迁移量和升级成本逐维评分",
          "Score capability, ecosystem dependencies, migration effort, and upgrade costs",
        ],
        [
          "交付版本化比较矩阵、试验结果和淘汰理由",
          "Deliver a versioned comparison matrix, trial evidence, and rejection reasons",
        ],
        [
          "未经运行的基准或社区活跃度不能伪作实测结果",
          "Do not present unrun benchmarks or assumed community activity as measured evidence",
        ],
      ],
      [
        [
          "列部署环境拓扑、发布频率、隔离要求、运维值守和预算",
          "List environment topology, release cadence, isolation, operations, and budget",
        ],
        [
          "比较本地、托管或混合部署的资源与恢复模型",
          "Compare resource and recovery models for on-premises, hosted, and hybrid deployment",
        ],
        [
          "生成部署比较、运行职责矩阵及回退条件",
          "Generate deployment comparison, operating RACI, and rollback conditions",
        ],
        [
          "不同环境的实际安全和成本必须分别验证",
          "Validate security and cost separately in each environment",
        ],
      ],
      [
        [
          "清点接口版本、调用方数量、弃用期限和兼容测试",
          "Inventory API versions, callers, deprecation dates, and compatibility tests",
        ],
        [
          "制定双版本窗口、调用方迁移确认及最终移除门槛",
          "Plan dual-version window, caller migration confirmation, and removal gate",
        ],
        [
          "输出版本支持政策、例外申请和通知日程",
          "Output version support policy, exception request, and notice schedule",
        ],
        [
          "删除旧版前不能把沉默调用方视作已迁移",
          "Do not treat silent callers as migrated before removing an old version",
        ],
      ],
      [
        [
          "提供模块职责、导入图、数据拥有者、测试和发布依赖",
          "Provide module duties, import graph, data owners, tests, and release dependencies",
        ],
        [
          "逐候选划分模块并评估循环依赖、部署顺序和失败隔离",
          "Evaluate cycles, deployment order, and failure isolation for each decomposition",
        ],
        [
          "交付边界决策、依赖图及分阶段实施计划",
          "Deliver boundary decisions, dependency graph, and phased implementation plan",
        ],
        [
          "模块重组不得隐式扩大读写权限或丢弃数据责任",
          "Restructuring must not silently expand access or drop data ownership",
        ],
      ],
    ],
  ),
  "onboarding-program": cases(
    "onboarding-program",
    {
      inputs: [
        "收集岗位职责、经理和导师、组织政策、课程、权限申请、设备时限与适用地区。",
        "Gather role duties, manager and mentor, policies, training, access requests, device timing, and location.",
      ],
      focus: [
        "按阶段安排可观察的学习、实践、反馈与权限核验，区分新人尚未完成和阻塞状态。",
        "Stage observable learning, practice, feedback, and access checks, distinguishing incomplete from blocked.",
      ],
      output: [
        "明确每项任务负责人、截止节点、所需证据、补课路径及复审安排。",
        "Specify each task's owner, due date, evidence, make-up path, and review schedule.",
      ],
      risk: [
        "人事资料最小化处理，账号开通须由授权系统负责人执行和确认。",
        "Minimize personnel data; authorized system owners provision and verify accounts.",
      ],
    },
    [
      [
        [
          "列岗位说明、入职日期、导师名单、设备和必读制度版本",
          "List role description, start date, mentor, equipment, and required policy versions",
        ],
        [
          "拆分首日权限、首周认识和季度目标并配置反馈节点",
          "Stage day-one access, first-week introductions, and quarter goals with feedback",
        ],
        [
          "交付分阶段清单、责任表及经理复核日历",
          "Deliver phased checklist, ownership table, and manager review calendar",
        ],
        [
          "缺少导师或账号审批时标为阻塞而非已完成",
          "Mark missing mentor or access approval as blocked, not complete",
        ],
      ],
      [
        [
          "收集仓库访问申请、语言工具版本、规范、导师和小任务",
          "Collect repository access request, tool versions, standards, mentor, and starter task",
        ],
        [
          "先用合成项目验证构建、测试和代码评审路径",
          "Validate build, test, and review flow with a synthetic project first",
        ],
        [
          "输出环境核验表、首项任务及评审证据要求",
          "Output environment checklist, starter task, and review evidence",
        ],
        [
          "禁止把密钥放入仓库并按岗位最小授权",
          "Keep secrets out of repositories and grant only role-necessary access",
        ],
      ],
      [
        [
          "列运营指标定义、数据来源、值班流程、工具和相关团队",
          "List metric definitions, data sources, shifts, tools, and partner teams",
        ],
        [
          "安排旁观、带教演练、数据解释和独立任务验收",
          "Sequence observation, guided practice, data interpretation, and independent acceptance",
        ],
        [
          "交付运营能力路线和指标口径练习",
          "Deliver an operations learning path and metric-definition exercises",
        ],
        [
          "数据权限不足时不得使用未经授权的真实客户数据",
          "Do not use real customer data without authorized access",
        ],
      ],
      [
        [
          "整理产品版本、销售阶段、价格授权、客户政策和导师名单",
          "Gather product versions, sales stages, pricing authority, customer policy, and mentors",
        ],
        [
          "按产品演示、跟访观察和模拟异议分阶段练习",
          "Stage practice through product demo, shadowing, and simulated objections",
        ],
        [
          "提供销售训练日历、话术审查和能力观察清单",
          "Provide a sales training calendar, claim review, and competency checklist",
        ],
        [
          "模拟训练不能授权新人向客户承诺条款",
          "Simulation does not authorize promises of customer terms",
        ],
      ],
      [
        [
          "列经理职责、团队目标、关键关系人和组织审批边界",
          "List manager duties, team goals, stakeholders, and approval boundaries",
        ],
        [
          "安排倾听访谈、风险检查、团队决定复核和阶段反馈",
          "Plan listening interviews, risk reviews, decision checks, and staged feedback",
        ],
        [
          "交付30/60/90天行动、交接问题及复盘模板",
          "Deliver 30/60/90-day actions, handover issues, and review templates",
        ],
        [
          "早期判断须标作观察假设，避免未经证实给员工贴标签",
          "Label early judgments as hypotheses and avoid unsupported employee labels",
        ],
      ],
      [
        [
          "列旧岗位未完事项、交接接受人、权限变更和新岗位目标",
          "List old-role open work, accepting owner, access changes, and new objectives",
        ],
        [
          "逐项确认责任移交后再关闭旧岗位待办",
          "Confirm each handoff before closing old-role actions",
        ],
        [
          "形成移交签收、权限变更请求和适应计划",
          "Create handover acknowledgment, access-change request, and adjustment plan",
        ],
        [
          "未交接工作和原权限过期点需经理人工复核",
          "Managers must review unhanded work and old-access expiry",
        ],
      ],
      [
        [
          "记录转出转入经理、项目责任、团队账号及生效日期",
          "Record outgoing and incoming managers, project ownership, team access, and date",
        ],
        [
          "协调工作交接、目标改写、培训补充及权限重审",
          "Coordinate handover, goal reset, supplementary training, and access review",
        ],
        ["交付跨团队移交表和30天跟进节点", "Deliver a cross-team transition and 30-day follow-up"],
        [
          "仅按角色共享必要人事信息，不转发无关评价",
          "Share only role-relevant personnel information, not unrelated evaluations",
        ],
      ],
      [
        [
          "列团队OKR、关键客户/项目、正在升级的风险和授权代理",
          "List team objectives, key accounts/projects, escalations, and delegates",
        ],
        [
          "以资料核对、关系人访谈及决策权限确认组织接任",
          "Structure succession around evidence review, interviews, and authority confirmation",
        ],
        [
          "输出关键决策日志、待办分层和首轮复审议程",
          "Output decision history, prioritized open work, and initial review agenda",
        ],
        [
          "保留历史决定原始背景，不将交接摘要改写为正式承诺",
          "Preserve context of prior decisions without turning a summary into commitments",
        ],
      ],
      [
        [
          "清点远程设备、网络要求、支持时段、时区和沟通渠道",
          "Inventory remote devices, network needs, support hours, time zones, and channels",
        ],
        [
          "先验证设备到达和安全配置，再安排结对及异步沟通",
          "Verify equipment and security before pairing and asynchronous onboarding",
        ],
        [
          "提供远程第一周日程、故障联系人和可访问性需求表",
          "Provide remote week-one schedule, support contacts, and accessibility form",
        ],
        [
          "Excel日期字段应另设时区并核查夏令时跨日",
          "Keep time zone separate from Excel dates and check daylight-saving boundaries",
        ],
      ],
      [
        [
          "记录实习周期、学习目标、监督人、允许任务与数据范围",
          "Record internship duration, learning goals, supervisor, tasks, and data scope",
        ],
        [
          "按学习阶段安排影随、演练、小任务和定期指导反馈",
          "Stage shadowing, practice, starter work, and coaching by learning phase",
        ],
        [
          "交付实习任务阶梯、导师检查点和成果展示安排",
          "Deliver an intern task ladder, mentor checkpoints, and demo plan",
        ],
        [
          "涉密任务和生产权限需先经组织审核并受限",
          "Review and restrict confidential tasks and production access",
        ],
      ],
      [
        [
          "列批次人数、房间设备、讲师、课程先修和异地成员",
          "List cohort size, rooms/devices, instructors, prerequisites, and remote members",
        ],
        [
          "编排公共课程与个别补课、测验和导师回访容量",
          "Plan shared training capacity alongside make-ups, quizzes, and mentor follow-up",
        ],
        [
          "输出批次日历、容量缺口及缺席补训方案",
          "Output cohort calendar, capacity gaps, and missed-session plan",
        ],
        [
          "实际出席要在实施后记录，排期不能视为已培训",
          "Record attendance after delivery; scheduling is not training completion",
        ],
      ],
      [
        [
          "收集员工同意提供的返岗安排、岗位变化、制度版本和支持角色",
          "Collect consented return plans, role changes, policy versions, and support owners",
        ],
        [
          "安排逐步恢复工作、知识更新及可调整的阶段复查",
          "Plan phased return, knowledge refresh, and adjustable check-ins",
        ],
        [
          "交付返岗清单、岗位复核和支持资源说明",
          "Deliver a return checklist, role review, and support resources",
        ],
        [
          "不推断医疗原因，仅记录授权提供的工作安排需求",
          "Do not infer medical causes; record only authorized work arrangements",
        ],
      ],
    ],
  ),
  "performance-review": cases(
    "performance-review",
    {
      inputs: [
        "仅使用经授权且与岗位相关的目标、工作证据、已记录反馈和员工补充材料，并注明周期和来源。",
        "Use only authorized role-relevant goals, work evidence, recorded feedback, and employee context; state period and sources.",
      ],
      focus: [
        "按事先说明的标准讨论可观察结果、阻碍和支持，不把单次事件或个人好恶概括为能力结论。",
        "Discuss observable outcomes, obstacles, and support against stated criteria; do not generalize from isolated events or personal preference.",
      ],
      output: [
        "形成供经理与员工核对的讨论摘要、发展行动、负责人和复查时间，保留争议及待确认事项。",
        "Prepare a discussion summary, development actions, owners, and review dates for manager and employee validation, preserving disagreements and open items.",
      ],
      risk: [
        "限制人员信息的访问与留存；评级、薪酬或晋升须遵循组织正式流程并由授权人员复核批准。",
        "Restrict personnel-data access and retention; authorized reviewers must decide ratings, compensation, and promotion through formal processes.",
      ],
    },
    [
      [
        [
          "整理季度目标、可核实交付、关键障碍和员工自述",
          "Gather quarterly goals, verifiable outcomes, obstacles, and employee reflection",
        ],
        [
          "逐项目标核对结果、变化原因及下一季度支持",
          "Review each goal, explain changes, and agree next-quarter support",
        ],
        [
          "输出季度回顾、行动负责人及下次检查日期",
          "Produce a quarterly review, action owners, and next check-in date",
        ],
        [
          "区分目标未完成与资源或范围变化，允许员工补充异议",
          "Separate missed goals from resource or scope changes and retain employee disagreement",
        ],
      ],
      [
        [
          "收集年度目标版本、全年成果、岗位变化及持续反馈",
          "Collect annual goal versions, outcomes, role changes, and ongoing feedback",
        ],
        [
          "按评价周期回顾结果与发展重点并核验背景变化",
          "Review results and development priorities across the stated period and check context changes",
        ],
        [
          "交付年度讨论纪要、证据索引和后续发展事项",
          "Deliver annual discussion notes, evidence index, and development follow-ups",
        ],
        [
          "未经正式流程不得把讨论草稿当作最终绩效或薪酬决定",
          "Do not treat draft discussions as final performance or compensation decisions",
        ],
      ],
      [
        [
          "列项目目标、分工记录、个人交付物及协作反馈来源",
          "List project goals, role records, individual deliverables, and feedback sources",
        ],
        [
          "将个人可归属贡献与团队共同结果分开核对",
          "Review attributable individual contributions separately from shared team outcomes",
        ],
        [
          "提供贡献矩阵、事实依据和待参与者确认的差异",
          "Provide a contribution matrix, evidence, and differences awaiting participant validation",
        ],
        [
          "避免把团队整体成败直接归因于单个成员",
          "Do not attribute overall team success or failure directly to one member",
        ],
      ],
      [
        [
          "整理阶段目标、里程碑日期、依赖资源和批准的变更",
          "Gather stage goals, milestone dates, dependencies, and approved changes",
        ],
        [
          "按目标当时有效的范围比较结果并记录外部影响",
          "Compare results against the scope in effect at the time and record external factors",
        ],
        [
          "交付阶段回顾、目标调整记录和下一阶段检查点",
          "Deliver a stage review, goal-change record, and next-stage checkpoints",
        ],
        [
          "不得使用事后改写的目标掩盖未获批准的范围变化",
          "Do not use retrospectively rewritten goals to conceal unapproved scope changes",
        ],
      ],
      [
        [
          "提供岗位能力标准版本、工作样本、具体情境和个人发展目标",
          "Provide the role competency standard version, work samples, examples, and development goals",
        ],
        [
          "围绕可观察行为设计练习、辅导反馈和阶段检查",
          "Design practice, coaching feedback, and checkpoints around observable behavior",
        ],
        [
          "输出能力证据对照、练习计划和复核日期",
          "Output a competency evidence map, practice plan, and review date",
        ],
        [
          "能力差距须有具体事例支持，不能用模糊标签定性",
          "Support competency gaps with specific examples rather than vague labels",
        ],
      ],
      [
        [
          "列管理岗位职责、已发生管理情境、团队反馈及来源限制",
          "List management duties, actual situations, team feedback, and source limitations",
        ],
        [
          "评估授权、沟通和决策行为并提出可练习的改进步骤",
          "Assess delegation, communication, and decision behaviors with practicable improvement steps",
        ],
        [
          "形成管理发展计划、支持资源和后续观察窗口",
          "Create a management development plan, support resources, and follow-up observation window",
        ],
        [
          "反馈来源仅限授权用途，不以匿名意见单独形成处分结论",
          "Use feedback sources only as authorized and do not base disciplinary findings on anonymous comments alone",
        ],
      ],
      [
        [
          "收集跨团队任务、责任交接、具体行为记录和相关反馈",
          "Collect cross-team tasks, ownership handoffs, behavioral records, and relevant feedback",
        ],
        [
          "识别促进协作的行为及有证据支持的改进行动",
          "Identify collaboration behaviors and evidence-supported improvement actions",
        ],
        [
          "交付情境化反馈摘要、协作行动和责任边界",
          "Deliver contextual feedback, collaboration actions, and ownership boundaries",
        ],
        [
          "保护非必要披露的同事信息，避免从行为推断人格",
          "Protect unnecessary colleague information and avoid inferring personality from behavior",
        ],
      ],
      [
        [
          "整理岗位要求、当前技能、员工表达的兴趣和可用学习资源",
          "Gather role requirements, current skills, stated interests, and available learning resources",
        ],
        [
          "与员工共同拆分目标能力、实践任务和导师检查节点",
          "Co-plan target skills, practice tasks, and mentor checkpoints with the employee",
        ],
        [
          "输出发展路线、资源责任人和可调整的阶段复盘",
          "Output a development path, resource owners, and adjustable stage reviews",
        ],
        [
          "发展建议不构成职位空缺、晋升资格或薪酬承诺",
          "Development guidance is not a promise of a vacancy, promotion eligibility, or compensation",
        ],
      ],
      [
        [
          "核对试用期开始日、事先告知目标、辅导记录和实际交付",
          "Verify probation dates, communicated objectives, coaching records, and actual work",
        ],
        [
          "按正式标准回顾达成情况、支持过程及尚需观察的事项",
          "Review attainment, support provided, and remaining observations against formal criteria",
        ],
        [
          "交付证据清单、员工回应和程序节点供授权负责人复核",
          "Deliver evidence, employee response, and process milestones for authorized review",
        ],
        [
          "不得预判正式结论；遵循当地劳动规则与组织申诉程序",
          "Do not predetermine the outcome; follow applicable labor rules and organizational appeal procedures",
        ],
      ],
      [
        [
          "收集新岗位职责生效时间、交接记录、初期目标和可比证据",
          "Collect new-role effective date, handoff records, initial goals, and comparable evidence",
        ],
        [
          "考虑学习曲线、环境变化和已提供支持后评估适应进展",
          "Assess adjustment after considering the learning curve, context changes, and support provided",
        ],
        [
          "形成适应回顾、待补资源及下一阶段目标",
          "Create an adjustment review, unmet support needs, and next-stage goals",
        ],
        [
          "避免用旧岗位标准直接评价新职责的短期表现",
          "Avoid applying old-role criteria directly to short-term performance in new duties",
        ],
      ],
      [
        [
          "列明目标岗位标准、可核实工作样本、现有职责和相关经验",
          "List target-role criteria, verifiable work samples, current duties, and relevant experience",
        ],
        [
          "对照标准识别已展示能力及尚待实践的具体差距",
          "Compare demonstrated capability with criteria and identify gaps needing practice",
        ],
        [
          "提供准备度分析、发展行动及由授权评审者作决定的事项",
          "Provide readiness analysis, development actions, and decisions reserved for authorized reviewers",
        ],
        [
          "分析或提名不能替代正式职位、预算和人事审批",
          "Analysis or nomination does not replace formal role, budget, and personnel approval",
        ],
      ],
      [
        [
          "保留原目标、调整理由、审批日期、新资源和适用周期",
          "Retain original goals, change reasons, approval dates, new resources, and applicable periods",
        ],
        [
          "按各阶段有效目标分别评价并解释责任边界变化",
          "Assess each period against its valid goals and explain changes in responsibility",
        ],
        [
          "输出调整前后对照和待经理员工共同确认的记录",
          "Output a before-and-after comparison for manager and employee validation",
        ],
        [
          "不得将未通知或未批准的目标追溯用于负面评价",
          "Do not retroactively use uncommunicated or unapproved goals for negative assessment",
        ],
      ],
    ],
  ),
  "incident-review": cases(
    "incident-review",
    {
      inputs: [
        "从获准的告警、操作记录和影响证据建立时间线，记录时区、数据责任人和证据缺口。",
        "Build a timeline from authorized alerts, operational records, and impact evidence, noting time zones, owners, and gaps.",
      ],
      focus: [
        "分开可观察事实、待验证假设和已确认原因，复核检测、缓解、恢复及系统性控制。",
        "Separate observed facts, hypotheses, and confirmed causes while reviewing detection, mitigation, recovery, and systemic controls.",
      ],
      output: [
        "给出影响范围、证据依据、改进事项、负责人和复验期限，供事件负责人及相关方核对。",
        "Provide impact scope, evidence, actions, owners, and retest dates for incident-owner and stakeholder validation.",
      ],
      risk: [
        "保护日志、账户和个人信息；对外通报、法律判断、客户通知及生产处置须由授权负责人按流程核验执行。",
        "Protect logs, account, and personal data; authorized owners must verify notices, legal decisions, customer communication, and production actions.",
      ],
    },
    [
      [
        [
          "调取服务告警、日志片段、事件时间线和受影响指标",
          "Retrieve service alerts, relevant logs, incident timeline, and affected metrics",
        ],
        [
          "复盘发现、升级、缓解和恢复各阶段的责任与耗时",
          "Review ownership and duration across detection, escalation, mitigation, and recovery",
        ],
        [
          "形成统一时区的事件时间线、影响摘要和证据清单",
          "Create a normalized-time incident timeline, impact summary, and evidence list",
        ],
        [
          "未知区间须明确标注，不以空白推断没有用户影响",
          "Mark unknown periods explicitly; a gap does not prove no user impact",
        ],
      ],
      [
        [
          "收集延迟、错误率、负载、近期变更和用户反馈数据",
          "Collect latency, error rates, load, recent changes, and user feedback",
        ],
        [
          "定位退化窗口并检验容量、排队和依赖等候选因素",
          "Locate degradation windows and test capacity, queueing, and dependency hypotheses",
        ],
        [
          "输出指标对齐图、候选解释及需补采的观测数据",
          "Output aligned metrics, candidate explanations, and missing telemetry",
        ],
        [
          "相关性仅用于提出假设，须有证据才能确认根因",
          "Correlation can suggest a hypothesis but cannot confirm a cause without evidence",
        ],
      ],
      [
        [
          "列发布批次、变更摘要、监控阈值触发和回退操作记录",
          "List rollout cohorts, change summaries, alert thresholds, and rollback records",
        ],
        [
          "比对影响起点与变更时间并检查测试、灰度和暂停门槛",
          "Compare impact onset with changes and review tests, canary gates, and pause criteria",
        ],
        [
          "交付变更与事件关联表、验证结果和防护改进项",
          "Deliver a change-to-incident timeline, verification results, and safeguard actions",
        ],
        [
          "时间接近不等于已证实因果，归责前应完成独立复核",
          "Temporal proximity is not proof of causation; complete independent review before assigning cause",
        ],
      ],
      [
        [
          "收集依赖状态页、调用超时、重试记录和本地降级行为",
          "Collect dependency status, call timeouts, retry records, and local degradation behavior",
        ],
        [
          "沿调用链检查故障传播、隔离边界和恢复顺序",
          "Trace propagation, isolation boundaries, and recovery order across calls",
        ],
        [
          "输出依赖故障图、服务影响和可测试的隔离改进",
          "Output a dependency failure map, service impact, and testable isolation improvements",
        ],
        [
          "第三方声明需与本地记录分开，责任和事实未经核验不定论",
          "Separate third-party statements from local records and do not assert unverified responsibility or facts",
        ],
      ],
      [
        [
          "确定数据处理批次、受影响对象范围、控制日志和恢复校验记录",
          "Identify processing batches, affected scope, control logs, and recovery checks",
        ],
        [
          "还原处理、发现、隔离和修复顺序并验证数据一致性",
          "Reconstruct processing, detection, isolation, and repair and verify data consistency",
        ],
        [
          "交付影响边界、证据保全清单及待人工复核的数据核对",
          "Deliver impact boundaries, evidence-preservation tasks, and data checks for human review",
        ],
        [
          "个人或敏感数据事件按授权升级，不复制不必要的原始记录",
          "Escalate personal or sensitive-data events as authorized and avoid unnecessary raw-record copies",
        ],
      ],
      [
        [
          "取得授权变更单、角色版本、审计事件和受影响账户统计",
          "Obtain authorized change tickets, role versions, audit events, and affected-account counts",
        ],
        [
          "复查申请、审批、生效与撤权是否满足既定权限控制",
          "Review whether request, approval, activation, and revocation followed access controls",
        ],
        [
          "形成权限事件时间线、控制缺口和复核责任人",
          "Create an access-event timeline, control gaps, and review owners",
        ],
        [
          "报告中使用汇总或脱敏标识，账户级调查须限定授权范围",
          "Use aggregate or redacted identifiers; account-level investigation requires bounded authorization",
        ],
      ],
      [
        [
          "收集配置版本、变更审批、部署批次、告警和恢复步骤",
          "Collect configuration versions, change approvals, rollout cohorts, alerts, and recovery steps",
        ],
        [
          "核对差异、评审和生效范围并验证回退是否达到预期",
          "Check diffs, review, effective scope, and whether rollback achieved its intended state",
        ],
        [
          "输出脱敏配置事件表及待补的自动校验控制",
          "Output a redacted configuration timeline and missing automated checks",
        ],
        [
          "不在结论中暴露密钥或敏感参数，实际生产修改需单独批准",
          "Do not expose secrets or sensitive parameters; production changes require separate approval",
        ],
      ],
      [
        [
          "仅整理已确认暴露范围、访问证据、遏制动作和响应时间",
          "Use only confirmed exposure scope, access evidence, containment actions, and response times",
        ],
        [
          "按事件响应职责核验隔离、调查、恢复和后续监测状态",
          "Verify containment, investigation, recovery, and follow-up monitoring against response duties",
        ],
        [
          "形成事实状态表、待确认影响和由负责人复核的行动清单",
          "Create a fact-status table, unresolved impact, and actions for owner review",
        ],
        [
          "未经安全和法务授权不发布通知，未知影响不得填写为零",
          "Do not issue notices without security and legal authorization; never record unknown impact as zero",
        ],
      ],
      [
        [
          "收集计划基线、依赖交付、实际日期、升级记录和沟通材料",
          "Collect baseline plans, dependencies, actual dates, escalations, and communications",
        ],
        [
          "定位延误链路及决策等待并区分可控因素和外部约束",
          "Trace delay dependencies and decision waits, separating controllable factors from external constraints",
        ],
        [
          "交付里程碑差异、流程改进事项和重新估算的依据",
          "Deliver milestone variances, process improvements, and evidence for revised estimates",
        ],
        [
          "保持系统性分析，未经事实核实不把延误归咎个人",
          "Keep analysis systemic and do not assign individual blame without verified facts",
        ],
      ],
      [
        [
          "列缺陷发现版本、验收标准、测试范围、影响和修复记录",
          "List defect discovery version, acceptance criteria, test coverage, impact, and fix records",
        ],
        [
          "追查缺陷逃逸路径、评审或测试控制及复现条件",
          "Trace defect escape paths, review or test controls, and reproduction conditions",
        ],
        [
          "形成缺陷影响清单、控制改进及复验状态字段",
          "Create a defect impact list, control improvements, and retest status fields",
        ],
        [
          "修复提交不代表问题已关闭，须记录独立验证和残余影响",
          "A fix commit does not close an issue; record independent validation and residual impact",
        ],
      ],
      [
        [
          "汇集事件沟通时间戳、值守角色、升级渠道和关键决定记录",
          "Gather communication timestamps, on-call roles, escalation paths, and decision records",
        ],
        [
          "识别交接遗漏、信息延迟或通知边界不清造成的阻塞",
          "Identify blockers caused by handoff gaps, delayed information, or unclear notification boundaries",
        ],
        [
          "输出沟通链路图、改进动作和经授权的通知模板",
          "Output a communication-path map, actions, and authorized notice templates",
        ],
        [
          "观点陈述与客观记录分开保存，客户或监管通知须按程序批准",
          "Separate opinions from factual records; approve customer or regulator notices through formal procedures",
        ],
      ],
      [
        [
          "对照操作步骤版本、实际操作记录、环境限制和影响证据",
          "Compare procedure versions, actual operation records, environment limits, and impact evidence",
        ],
        [
          "检查流程是否存在模糊分支、危险默认值或缺失防错检查",
          "Check for ambiguous branches, unsafe defaults, or missing error-prevention checks",
        ],
        [
          "交付流程差距、建议控制、负责人和验证场景",
          "Deliver procedure gaps, control proposals, owners, and validation scenarios",
        ],
        [
          "保留必要证据并限制访问，不将系统设计缺陷简单归咎于操作者",
          "Preserve necessary evidence with restricted access and do not reduce design failures to operator blame",
        ],
      ],
    ],
  ),
  "governance-review": cases(
    "governance-review",
    {
      inputs: [
        "依据经批准的评审范围、制度版本、授权记录和可访问证据开展抽查，并记录样本限制。",
        "Review approved scope, policy versions, authority records, and accessible evidence while documenting sampling limits.",
      ],
      focus: [
        "分别检查控制设计、执行证据、例外批准和整改复验，不把管理层声明当成独立验证。",
        "Assess control design, execution evidence, exception approval, and retesting separately; do not treat management assertions as independent validation.",
      ],
      output: [
        "形成有证据索引的观察、影响、责任人与建议期限，供治理责任人及合格审阅者复核。",
        "Prepare evidence-linked observations, impact, owners, and proposed dates for governance owners and qualified reviewers.",
      ],
      risk: [
        "结论不构成审计鉴证、法律意见或合规认证；正式认定及整改、披露和外部承诺均须获授权人工核验。",
        "Findings are not audit assurance, legal advice, or compliance certification; authorized humans must verify formal determinations and commitments.",
      ],
    },
    [
      [
        [
          "取得治理章程、授权矩阵、年度目标、会议纪要和风险记录版本",
          "Obtain governance charter, authority matrix, annual goals, minutes, and risk-record versions",
        ],
        [
          "对照职责检查决策记录、监督行动和未完成承诺",
          "Compare responsibilities with decisions, oversight actions, and open commitments",
        ],
        [
          "输出范围说明、证据索引和待治理机构确认的事项",
          "Output scope, evidence index, and items for governing-body confirmation",
        ],
        [
          "样本不足或文件缺失时限制结论，不称为独立鉴证",
          "Limit conclusions for missing documents or samples and do not call the work independent assurance",
        ],
      ],
      [
        [
          "抽取控制目标、现行流程、执行样本、例外和批准记录",
          "Sample control objectives, current procedures, execution evidence, exceptions, and approvals",
        ],
        [
          "分别评估设计是否充分、执行是否一致及例外是否获批",
          "Assess design adequacy, consistent execution, and approved exceptions separately",
        ],
        [
          "形成控制测试表、偏差说明和需复验的改进项",
          "Create a control test table, deviations, and improvements requiring retest",
        ],
        [
          "抽样通过不能推断未抽取期间或全部场景均有效",
          "Sampled success does not prove untested periods or scenarios effective",
        ],
      ],
      [
        [
          "整理风险登记、评分依据、控制状态、责任人和最近审议日期",
          "Gather risk register, rating basis, control status, owners, and latest review dates",
        ],
        [
          "比较风险变化、控制效果和处置优先级并标注证据时点",
          "Compare risk movements, control effects, and treatment priorities with evidence dates",
        ],
        [
          "输出风险趋势、待处置清单及责任人复核节点",
          "Output risk trends, treatment backlog, and owner review points",
        ],
        [
          "风险评分属于当前判断，未经复核不得作为未来保证或承诺",
          "Risk ratings are current judgments and are not future assurance or commitments without review",
        ],
      ],
      [
        [
          "列整改事项、承诺日期、完成证据、复验记录和剩余风险",
          "List remediation items, committed dates, completion evidence, retests, and residual risks",
        ],
        [
          "追踪逾期原因、措施实际效果和是否需要重新定级",
          "Trace overdue causes, actual effectiveness, and whether reprioritization is needed",
        ],
        [
          "交付整改状态、复验结论待定项和升级路径",
          "Deliver remediation status, pending retest conclusions, and escalation paths",
        ],
        [
          "行动标记完成不等于控制通过，必须保留独立复验结果",
          "Marking an action complete does not pass a control; retain independent retest results",
        ],
      ],
      [
        [
          "收集供应商分类、准入资质、履约指标、合同和退出条款",
          "Collect supplier categories, qualification, performance metrics, contracts, and exit terms",
        ],
        [
          "检查准入尽调、持续监控、问题升级和退出准备是否执行",
          "Check whether due diligence, monitoring, escalation, and exit preparation operated",
        ],
        [
          "形成供应商治理样本、缺失证据和整改建议",
          "Create a supplier-governance sample, missing evidence, and remediation suggestions",
        ],
        [
          "供应商自报材料须与合同、记录或独立证据交叉核对",
          "Cross-check supplier assertions against contracts, records, or independent evidence",
        ],
      ],
      [
        [
          "抽取采购申请、审批、比价、订单、收货和供应商记录",
          "Sample purchase requests, approvals, quotes, orders, receipt, and supplier records",
        ],
        [
          "核对授权层级、比价依据、职责分离和例外审批链",
          "Check authority levels, quote basis, separation of duties, and exception approvals",
        ],
        [
          "输出采购控制抽查表、差异证据及补核事项",
          "Output a procurement-control sample, discrepancy evidence, and follow-up items",
        ],
        [
          "制度阈值和审批事实必须来自当前批准文件，不能凭经验补写",
          "Policy thresholds and approvals must come from current approved documents, not assumption",
        ],
      ],
      [
        [
          "列外包合同、服务水平、访问边界、报告和事件记录",
          "List outsourcing contracts, service levels, access boundaries, reports, and incidents",
        ],
        [
          "比较约定服务、实际交付、控制证据及退出可行性",
          "Compare contracted service, actual delivery, control evidence, and exit feasibility",
        ],
        [
          "交付外包治理对照、例外清单和供应商改进责任",
          "Deliver an outsourcing-governance comparison, exceptions, and supplier actions",
        ],
        [
          "供应商声明不等于组织验证，访问和退出责任须有证据支持",
          "Supplier claims are not organizational validation; access and exit duties need evidence",
        ],
      ],
      [
        [
          "收集授权矩阵、支出审批、付款记录、岗位职责和版本日期",
          "Collect authority matrix, spending approvals, payment records, duties, and version dates",
        ],
        [
          "抽查申请、批准、付款和复核之间是否保持职责分离",
          "Sample whether request, approval, payment, and review preserve segregation of duties",
        ],
        [
          "形成权限与支付流程对照、例外审批和复核计划",
          "Create an authority-to-payment comparison, exceptions, and review plan",
        ],
        [
          "权限矩阵过期或例外未批准时限制结论并升级核查",
          "Limit conclusions and escalate when matrices are stale or exceptions unapproved",
        ],
      ],
      [
        [
          "盘点账号、角色、批准记录、定期复核和离职时间点",
          "Inventory accounts, roles, approvals, periodic reviews, and departure dates",
        ],
        [
          "抽查权限是否与岗位相符、是否及时撤回和有复核证据",
          "Sample role fit, timely revocation, and review evidence",
        ],
        [
          "交付账号抽查结果、异常责任人及整改期限",
          "Deliver account-sample results, exception owners, and remediation dates",
        ],
        [
          "账户信息按最小范围脱敏处理，未经授权不得导出或共享",
          "Minimize and redact account data; do not export or share without authorization",
        ],
      ],
      [
        [
          "列数据资产、责任人、分类标签、处理目的和例外记录",
          "List data assets, owners, classification labels, purposes, and exceptions",
        ],
        [
          "检查责任分配、使用范围、访问审批及例外处置是否一致",
          "Check consistency of ownership, use scope, access approval, and exception handling",
        ],
        [
          "输出数据治理对照、证据缺口和责任人复核事项",
          "Output a data-governance comparison, evidence gaps, and owner review items",
        ],
        [
          "抽样和访问范围有限时须明确限制，不推断全部数据资产合规",
          "State sampling and access limits; do not infer all data assets are compliant",
        ],
      ],
      [
        [
          "取得记录目录、保留政策、存储位置、到期清单和销毁证据",
          "Obtain record inventory, retention policy, storage locations, expiry lists, and destruction evidence",
        ],
        [
          "核对保留期限、暂停销毁要求、到期处理和执行记录",
          "Check retention periods, legal holds, expiry handling, and execution records",
        ],
        [
          "交付记录保留抽查、逾期事项及需制度确认的期限",
          "Deliver retention samples, overdue items, and periods requiring policy confirmation",
        ],
        [
          "法定期限需由适用制度和合格人员确认，不能自行推定",
          "Qualified reviewers and applicable policy must confirm legal periods; do not infer them",
        ],
      ],
      [
        [
          "收集现行制度版本、培训记录、执行样本、例外和覆盖人员范围",
          "Collect current policy versions, training records, execution samples, exceptions, and coverage",
        ],
        [
          "比较制度传达、实际执行、反馈和例外处理之间的差距",
          "Compare policy communication, actual execution, feedback, and exception handling",
        ],
        [
          "形成制度执行观察、改进责任人和补训或复核安排",
          "Create policy-execution observations, owners, and retraining or review plans",
        ],
        [
          "注明未覆盖人员和制度版本，不能将排期或培训邀请当作已完成",
          "State uncovered people and policy versions; invitations or schedules are not completion evidence",
        ],
      ],
    ],
  ),
  // LEGACY_C_CONTINUE
};
