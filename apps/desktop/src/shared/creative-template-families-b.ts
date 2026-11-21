import type { CreativeExtendedFamily, CreativeTranslation } from "./creative-template-authoring";

type Pair = CreativeTranslation;
type ScenarioRow = readonly [Pair, Pair, Pair, Pair, Pair];
type ScenarioDetail = Readonly<{
  focus: Pair;
  inputs: Pair;
  output: Pair;
  risk: Pair;
}>;

function scenarios(
  audience: Pair,
  context: { focus: Pair; inputs: Pair; output: Pair; risk: Pair },
  rows: readonly ScenarioRow[],
  details: Readonly<Record<string, ScenarioDetail>> = {},
): CreativeExtendedFamily["scenarios"] {
  return rows.map(([name, focus, inputs, output, risk]) => ({
    name,
    audience,
    brief: { focus, output, risk },
    focus: [
      `${focus[0]}${details[name[0]]?.focus[0] ?? ""}${context.focus[0]}`,
      `${focus[1]} ${details[name[0]]?.focus[1] ?? ""} ${context.focus[1]}`,
    ],
    inputs: [
      `${inputs[0]}${details[name[0]]?.inputs[0] ?? ""}${context.inputs[0]}`,
      `${inputs[1]} ${details[name[0]]?.inputs[1] ?? ""} ${context.inputs[1]}`,
    ],
    output: [
      `${output[0]}${details[name[0]]?.output[0] ?? ""}${context.output[0]}`,
      `${output[1]} ${details[name[0]]?.output[1] ?? ""} ${context.output[1]}`,
    ],
    risk: [
      `${risk[0]}${details[name[0]]?.risk[0] ?? ""}${context.risk[0]}`,
      `${risk[1]} ${details[name[0]]?.risk[1] ?? ""} ${context.risk[1]}`,
    ],
  }));
}

const CUSTOMER_SUCCESS_DETAILS: Readonly<Record<string, ScenarioDetail>> = {
  客户启动准备: {
    focus: [
      "使用启动门槛表逐项确认合同范围、数据接口、培训责任和首周会议，并以可启动、阻塞、待确认三态安排责任人。",
      "Use a launch-gate sheet to confirm contract scope, data interfaces, training owners, and the first-week cadence, with ready, blocked, and pending states.",
    ],
    inputs: [
      "补充合同附件编号、客户管理员、里程碑基线、支持入口和联系人时区，所有门槛记录证据链接。",
      "Add contract annex IDs, customer admins, milestone baseline, support entry points, and contact time zones with evidence links.",
    ],
    output: [
      "交付启动门槛表、RACI、首周议程、风险登记首版和客户需确认的开放问题。",
      "Deliver a launch-gate table, RACI, first-week agenda, initial risk register, and customer questions to confirm.",
    ],
    risk: [
      "会议预约、资料发送或内部准备完成均不等于客户已经接受启动；缺签字或管理员确认时保持阻塞。",
      "A booked meeting or internal preparation is not customer acceptance; keep the gate blocked without sign-off or admin confirmation.",
    ],
  },
  客户上线检查: {
    focus: [
      "按切换清单核对配置、权限、数据抽样、培训和支持值守，明确冒烟测试、回退点及上线决策时间。",
      "Use a cutover checklist for configuration, access, data samples, training, and support coverage, with smoke tests, rollback points, and a go decision time.",
    ],
    inputs: [
      "收集验收用例编号、缺陷严重度、变更窗口、回退负责人、客户签收人及未关闭工单。",
      "Collect acceptance case IDs, defect severity, change window, rollback owner, customer signatory, and open tickets.",
    ],
    output: [
      "形成上线红黄绿门槛表、冒烟测试结果、值守通讯录和回退触发条件。",
      "Produce a red-amber-green readiness table, smoke-test results, on-call contacts, and rollback triggers.",
    ],
    risk: [
      "演示通过、内部测试或口头同意不能替代客户验收；高严重度缺陷未关闭时不得标记可上线。",
      "A demo, internal test, or verbal agreement cannot replace customer acceptance; do not mark ready with high-severity defects open.",
    ],
  },
  客户采用计划: {
    focus: [
      "按角色和业务任务拆分激活、重复使用、关键流程完成率与阻碍，设计每一阶段的辅导动作和观察窗口。",
      "Break activation, repeat use, and key-task completion down by role and job, then assign coaching actions and observation windows.",
    ],
    inputs: [
      "提供授权用户分群、启用事件、功能使用深度、培训完成和工单记录，注明统计分母与截止日。",
      "Provide authorized cohorts, activation events, usage depth, training completion, and tickets with denominators and cutoff dates.",
    ],
    output: [
      "交付分群采用漏斗、每组障碍假设、七日和三十日行动卡以及成功复核指标。",
      "Deliver a cohort adoption funnel, obstacle hypotheses, seven- and thirty-day action cards, and success checks.",
    ],
    risk: [
      "登录次数、单一功能点击或培训出席不能单独证明业务价值；未获授权的用户行为不得进入报告。",
      "Logins, one-feature clicks, or attendance alone do not prove business value; exclude unauthorized user activity.",
    ],
  },
  客户培训跟进: {
    focus: [
      "将出席、练习、测验和实际任务完成分开核对，按能力缺口安排补训、答疑和再次评估。",
      "Reconcile attendance, practice, assessment, and real-task completion separately, then schedule make-up training and reassessment by gap.",
    ],
    inputs: [
      "收集课程版本、参训名单、签到、练习提交、测验分数、讲师反馈和客户可用时间。",
      "Collect course versions, rosters, attendance, practice submissions, scores, trainer feedback, and customer availability.",
    ],
    output: [
      "形成能力覆盖矩阵、个人或小组补训计划、常见问题清单和再测通过标准。",
      "Produce a capability coverage matrix, individual or group make-up plan, FAQ list, and reassessment criteria.",
    ],
    risk: [
      "参加课程不等于掌握；分数缺失、题目版本不一致或无实际任务证据时标记未验证。",
      "Attendance is not mastery; mark unverified when scores, versions, or real-task evidence are missing.",
    ],
  },
  客户业务回顾: {
    focus: [
      "用基线到当前值的指标桥解释变化，将产品贡献、客户行动和外部因素分列，并把下一季度目标转成可检查动作。",
      "Use a baseline-to-current metric bridge, separating product contribution, customer actions, and external factors, then turn next-quarter goals into checks.",
    ],
    inputs: [
      "锁定合同目标、期间、指标定义、数据抽取时间、客户原话、案例许可和上期行动完成状态。",
      "Lock contract goals, period, metric definitions, extraction time, customer quotes, case permission, and prior action status.",
    ],
    output: [
      "交付业务回顾页、指标桥、证据目录、共同决策清单和带负责人与日期的下阶段计划。",
      "Deliver a business-review deck, metric bridge, evidence index, joint decisions, and a dated next-period plan with owners.",
    ],
    risk: [
      "相关变化不能直接归因于产品；客户未确认的成果、案例或续用意向必须保留为假设。",
      "Correlated change cannot be attributed to the product directly; unconfirmed outcomes, cases, or renewal intent remain hypotheses.",
    ],
  },
  低活跃客户跟进: {
    focus: [
      "先按约定阈值识别活跃下降，再区分季节、账号变更、服务中断和业务暂停，安排有问题清单的定向联系。",
      "Apply the agreed threshold before identifying decline, then separate seasonality, account changes, outages, and business pauses for targeted outreach.",
    ],
    inputs: [
      "收集同期群活跃基线、最后活动时间、关键功能事件、支持工单、客户联系人变更和暂停记录。",
      "Collect cohort activity baseline, last-use time, key feature events, support tickets, contact changes, and pause records.",
    ],
    output: [
      "输出低活跃分层、逐客户核实问题、联系节奏、复活试验和复查指标，保留未联系原因。",
      "Output low-activity tiers, customer questions, contact cadence, reactivation tests, review metrics, and reasons not contacted.",
    ],
    risk: [
      "低活跃不等于流失或不满意；小样本、删失周期和未授权行为数据不得用于确定性判断。",
      "Low activity is not churn or dissatisfaction; do not make certain claims from small samples, censored periods, or unauthorized data.",
    ],
  },
  重点问题升级: {
    focus: [
      "按影响、范围、客户承诺和恢复依赖建立单一事件时间线，规定更新频率、发言人和跨团队决策点。",
      "Build one incident timeline by impact, scope, customer commitments, and recovery dependencies, setting update cadence, spokesperson, and decisions.",
    ],
    inputs: [
      "记录事件编号、发现和升级时间、受影响客户、临时措施、证据快照、当前负责人和下一次更新时限。",
      "Record incident ID, detection and escalation times, affected customers, mitigations, evidence snapshots, owner, and next update deadline.",
    ],
    output: [
      "交付客户影响摘要、事件状态表、责任矩阵、沟通草稿、恢复验证项和事后复盘入口。",
      "Deliver a customer-impact summary, status table, ownership matrix, communication draft, recovery checks, and retrospective entry.",
    ],
    risk: [
      "恢复时间和根因未确认时不得承诺；调查中的个人或安全信息按最小披露原则隔离。",
      "Do not promise recovery time or root cause before confirmation; isolate personal and security information to the minimum disclosure.",
    ],
  },
  客户需求反馈: {
    focus: [
      "把原始请求拆成用户任务、影响、频率、替代方案和成功定义，区分产品机会、服务问题与合同要求。",
      "Break each request into job, impact, frequency, alternatives, and success definition, separating product opportunities, service issues, and contract needs.",
    ],
    inputs: [
      "保留客户原话、提出时间、角色、使用场景、影响证据、现有替代和重复请求关联编号。",
      "Retain customer wording, date, role, use case, impact evidence, current alternatives, and linked repeat-request IDs.",
    ],
    output: [
      "形成产品评审卡、证据等级、优先级理由、待验证问题和反馈回告节点，不代替路线图决策。",
      "Create a product-review card, evidence level, priority rationale, validation questions, and feedback checkpoint without deciding the roadmap.",
    ],
    risk: [
      "一次请求、销售意见或内部偏好不能代表全部客户；不把评审登记写成已承诺交付。",
      "One request, seller opinion, or internal preference does not represent all customers; a review entry is not a delivery commitment.",
    ],
  },
  服务范围调整: {
    focus: [
      "对照现有合同和服务目录拆分新增、减少、暂停及转交范围，核算资源、响应目标、费用和验收变化。",
      "Compare the contract and service catalog to split additions, reductions, pauses, and transfers, including resources, response targets, fees, and acceptance.",
    ],
    inputs: [
      "收集变更请求版本、合同条款、影响流程、人员容量、时间表、依赖系统和双方审批链。",
      "Collect change-request version, contract terms, affected workflows, capacity, schedule, dependencies, and both approval chains.",
    ],
    output: [
      "输出范围差异表、变更订单草案、过渡责任、验收标准和客户沟通日程。",
      "Output a scope-difference table, change-order draft, transition ownership, acceptance criteria, and customer communication schedule.",
    ],
    risk: [
      "讨论稿、报价或临时资源安排不构成合同修改；签署前不得调整服务承诺或删除原有责任。",
      "Discussion, pricing, or temporary staffing is not a contract amendment; do not change commitments before signature.",
    ],
  },
  续约准备: {
    focus: [
      "从合同期限倒排价值证据、遗留问题、预算窗口、决策人会议和方案审批，区分续约条件与销售假设。",
      "Back-plan value evidence, open issues, budget windows, decision meetings, and proposal approval from the contract date, separating conditions from sales assumptions.",
    ],
    inputs: [
      "核对合同到期与通知日、已交付证据、使用和支持数据、未结争议、客户决策流程和报价版本。",
      "Check expiry and notice dates, delivery evidence, usage and support data, open disputes, decision process, and quote version.",
    ],
    output: [
      "交付续约证据包、双方行动计划、关键决策日、风险门槛和需客户确认的条款清单。",
      "Deliver a renewal evidence pack, mutual action plan, decision dates, risk gates, and terms requiring customer confirmation.",
    ],
    risk: [
      "使用情况、口头反馈或报价草案不能证明续约意向；未签协议不得标记续约成功。",
      "Usage, verbal feedback, or a draft quote does not prove renewal intent; do not mark renewal successful without a signed agreement.",
    ],
  },
  客户联系人交接: {
    focus: [
      "以联系人角色、授权范围、当前承诺和沟通偏好组织交接，逐项确认新负责人已接收可访问资料。",
      "Organize the handoff by contact roles, authorization, commitments, and communication preferences, confirming the new owner can access each item.",
    ],
    inputs: [
      "收集经客户确认的姓名与角色、同意范围、未结行动、会议记录、合同边界和时区渠道。",
      "Collect customer-confirmed names and roles, consent scope, open actions, meeting records, contract boundaries, and time-zone channels.",
    ],
    output: [
      "形成联系人矩阵、事项交接清单、权限确认、客户通知草稿及七日复查安排。",
      "Produce a contact matrix, handoff checklist, access confirmation, customer-notice draft, and seven-day review.",
    ],
    risk: [
      "不能把内部备注或未经授权联系方式转给客户；交接会议完成不代表责任已被新负责人接受。",
      "Do not share internal notes or unauthorized contacts; a handoff meeting does not prove the new owner accepted responsibility.",
    ],
  },
  客户终止服务交接: {
    focus: [
      "按终止条款安排通知、资料导出、未结问题、账户停用和保留期限，明确每个动作的授权人与确认凭据。",
      "Sequence notice, data export, open issues, account deactivation, and retention by termination terms, with an authorized owner and evidence for each action.",
    ],
    inputs: [
      "核对终止通知、服务和数据移交范围、导出格式、联系人、待付款、保留/删除要求及时间表。",
      "Check termination notice, service and data handoff scope, export format, contacts, payments, retention/deletion rules, and timeline.",
    ],
    output: [
      "交付终止清单、资料交接索引、未结责任、账户状态记录和双方签收节点。",
      "Deliver a closure checklist, data-handoff index, remaining responsibilities, account-state record, and bilateral sign-off gates.",
    ],
    risk: [
      "未经授权不得删除客户数据或停用账户；合同义务、法定保留和争议事项未结时保持暂停。",
      "Do not delete customer data or deactivate accounts without authorization; pause while contractual, legal-retention, or dispute obligations remain open.",
    ],
  },
};

const SALES_ENABLEMENT_DETAILS: Readonly<Record<string, ScenarioDetail>> = {
  首次客户会面: {
    focus: [
      "先把会议目标限定为了解客户现状、角色和决策路径，再安排三段式开场、探索问题、复述确认与下一步，不把产品演示提前替代需求发现。",
      "Limit the meeting to understanding the customer's current state, roles, and decision path, then sequence an opening, discovery, playback, and next step rather than replacing discovery with an early demo.",
    ],
    inputs: [
      "补充参会人职位和关注点、已知业务背景、会议时长、可公开产品信息、保密边界和主持人记录模板，标出尚未验证的假设。",
      "Add attendee roles and concerns, known business context, meeting duration, approved product facts, confidentiality boundaries, and a host note template, marking unvalidated assumptions.",
    ],
    output: [
      "交付可直接使用的开场稿、分层提问卡、客户原话记录表、信息缺口和双方约定的后续行动及日期。",
      "Deliver a usable opening script, tiered question cards, a verbatim-notes sheet, information gaps, and mutually agreed actions with dates.",
    ],
    risk: [
      "不要把销售方的行业判断写成客户需求；会议纪要须由客户或销售负责人复核，未得到客户回应的痛点保留为待确认。",
      "Do not turn seller assumptions into customer needs; have the customer or sales owner review notes and keep unconfirmed pain points open.",
    ],
  },
  需求发现访谈: {
    focus: [
      "按现状流程、痛点影响、现有替代、决策标准和采购约束设计追问树，每个问题注明目的、可能证据及何时转入下一层。",
      "Build a question tree across current process, impact, alternatives, decision criteria, and buying constraints, noting each question's purpose, evidence, and branch condition.",
    ],
    inputs: [
      "收集行业与组织背景、访谈对象职责、已知线索、业务指标、现有工具、时间范围和允许记录的范围，保留原始回答及来源。",
      "Gather industry and organization context, interviewee responsibilities, known leads, business metrics, current tools, period, and recording permission, retaining verbatim answers and sources.",
    ],
    output: [
      "形成按主题分组的访谈脚本、追问分支、证据登记、决策人地图和会后待验证假设，不直接生成报价或承诺。",
      "Create a themed interview script, follow-up branches, evidence register, decision-maker map, and post-meeting hypotheses without generating a quote or commitment.",
    ],
    risk: [
      "避免诱导式问题和选择性摘录；单个受访者的意见不得代表组织共识，敏感信息只按明确授权留存。",
      "Avoid leading questions and selective quotes; one interviewee cannot represent organizational consensus, and sensitive information requires explicit permission.",
    ],
  },
  产品能力演示: {
    focus: [
      "从已确认的客户任务倒排演示脚本，依次呈现前置条件、关键操作、可观察结果和限制，并为权限、数据或网络异常准备替代路径。",
      "Back-plan a demo from a confirmed customer job, showing prerequisites, key actions, observable results, and limits, with fallbacks for access, data, or network failures.",
    ],
    inputs: [
      "核对产品版本与租户配置、演示数据来源、功能开关、账号权限、屏幕比例、演示时长和禁止展示的内部信息。",
      "Check product version and tenant configuration, demo-data source, feature flags, account permissions, screen ratio, duration, and internal information not to show.",
    ],
    output: [
      "交付逐分钟演示脚本、讲者提示、客户任务与功能映射、截图或录屏清单、故障回退方案和验证后链接。",
      "Deliver a minute-by-minute script, speaker notes, customer-job mapping, screenshot or recording list, failure fallback, and verified links.",
    ],
    risk: [
      "演示环境中的模拟数据和手工步骤不能证明生产可用；功能、版本或接口未实测时必须明确写成待验证。",
      "Mock data and manual demo steps do not prove production readiness; mark features, versions, or interfaces as unverified when not tested.",
    ],
  },
  行业场景介绍: {
    focus: [
      "把行业流程拆成角色、触发事件、关键任务、输出物和合规约束，再逐项映射可用能力与适用前提，避免只堆砌行业术语。",
      "Decompose the industry workflow into roles, triggers, jobs, outputs, and compliance constraints, then map actual capabilities and prerequisites instead of piling up jargon.",
    ],
    inputs: [
      "使用可核实的公开行业资料、客户所属细分市场、流程样例、产品限制、授权案例及法规版本，并记录每项来源日期。",
      "Use verifiable public industry sources, the customer's segment, workflow examples, product limits, authorized cases, and regulation versions with source dates.",
    ],
    output: [
      "形成一页场景总览、角色泳道、痛点与能力对照、证据等级、实施前提及需要客户确认的差异问题。",
      "Create a one-page overview, role swimlane, pain-to-capability mapping, evidence levels, implementation prerequisites, and differences to confirm.",
    ],
    risk: [
      "行业通用流程不能当作客户现状，法规或案例过期会误导决策；未核实的合规表述必须交专业人员审核。",
      "A generic industry process is not the customer's current state; stale regulations or cases can mislead, and unverified compliance claims need specialist review.",
    ],
  },
  客户案例讲解: {
    focus: [
      "按挑战、背景条件、实施动作、可衡量结果和限制组织案例叙事，区分客户原话、已核实数字与讲解者的解释。",
      "Structure the case around challenge, context, implementation, measurable outcomes, and limits, separating customer quotes, verified figures, and interpretation.",
    ],
    inputs: [
      "收集书面授权范围、客户与行业匿名要求、基线及对比期间、实施条件、数据口径、引用文字和素材版本。",
      "Collect written permissions, anonymization requirements, baseline and comparison period, implementation conditions, metric definitions, quotes, and asset versions.",
    ],
    output: [
      "交付可审阅的案例时间线、挑战—行动—结果页、证据注释、适用条件、限制说明和对外引用审批清单。",
      "Deliver a reviewable timeline, challenge-action-result slides, evidence notes, applicability conditions, limitations, and an external-quote approval list.",
    ],
    risk: [
      "案例结果不能保证复制到其他客户；未经书面许可不得公开名称、指标或截图，也不能删去不利限制。",
      "Case outcomes are not guaranteed for another customer; do not publish names, metrics, or screenshots without written permission or omit limits.",
    ],
  },
  常见异议应答: {
    focus: [
      "按成本、迁移、集成、安全、交付和采购流程建立异议分类，先确认问题真实含义，再给事实、边界、验证动作和升级路径。",
      "Classify objections into cost, migration, integration, security, delivery, and procurement, clarifying intent before giving facts, limits, validation, and escalation.",
    ],
    inputs: [
      "汇总录音或纪要中的原始异议、客户角色、出现阶段、已批准答复、产品专家联系人、证据链接和不得承诺的事项。",
      "Compile verbatim objections from notes or recordings, roles, deal stage, approved answers, expert contacts, evidence links, and non-promissible items.",
    ],
    output: [
      "形成按场景检索的问答卡、三句式回应、证据和限制、澄清问题、升级触发条件及跟进责任人。",
      "Create searchable scenario cards with three-part responses, evidence and limits, clarifying questions, escalation triggers, and follow-up owners.",
    ],
    risk: [
      "未知问题不能用猜测补全；安全、法律、价格和服务等级回答须引用批准版本，过期答复要显眼标记。",
      "Do not fill unknowns with guesses; security, legal, pricing, and service-level answers must cite approved versions and flag stale content.",
    ],
  },
  竞争方案比较: {
    focus: [
      "先确认客户决策标准和比较范围，再用同一版本、同一场景和同一证据等级比较能力、成本、实施与限制，不做无依据排名。",
      "Confirm decision criteria and scope first, then compare capability, cost, implementation, and limits using the same versions, scenario, and evidence level.",
    ],
    inputs: [
      "记录客户权重、公开资料网址和日期、实测范围、供应商声明、合同限制、评估版本及无法核实的字段。",
      "Record customer weights, public URLs and dates, test scope, vendor claims, contract limits, evaluation versions, and unverifiable fields.",
    ],
    output: [
      "输出带来源的标准化比较表、客户权重计算、未知项清单、验证建议和中立的讨论问题，保留原始引用。",
      "Output a sourced normalized comparison, customer-weight calculation, unknowns, validation suggestions, and neutral discussion questions with original citations.",
    ],
    risk: [
      "资料缺失不能证明竞品没有能力；不能贬损对手或把未实测的性能、价格和合规状态写成事实。",
      "Missing information does not prove a competitor lacks capability; do not disparage competitors or state untested performance, price, or compliance as fact.",
    ],
  },
  试点范围讨论: {
    focus: [
      "把试点拆成目标场景、参与角色、数据边界、时间盒、成功指标、退出条件和双方责任，先解决可验证性再讨论扩展。",
      "Break a pilot into target use cases, roles, data boundaries, time box, success metrics, exit criteria, and mutual responsibilities before discussing expansion.",
    ],
    inputs: [
      "收集候选流程、样本或数据集、参与人数、环境依赖、预算、支持窗口、风险限制和客户可接受的验收口径。",
      "Gather candidate workflows, samples or datasets, participants, environment dependencies, budget, support window, risk limits, and acceptable acceptance criteria.",
    ],
    output: [
      "形成试点章程、范围内外表、里程碑、指标基线、问题升级路径、退出判断和双方签字待办。",
      "Create a pilot charter, in/out-of-scope table, milestones, metric baseline, escalation path, exit decision, and sign-off actions.",
    ],
    risk: [
      "试点环境和样本不代表全面生产；未签署的成功标准、费用、数据使用和上线承诺保持草案状态。",
      "A pilot environment and sample do not represent full production; unsigned success criteria, fees, data use, and launch promises remain drafts.",
    ],
  },
  商业价值论证: {
    focus: [
      "以客户认可的基线、成本驱动和计量周期建立价值模型，展示公式、敏感性和不可归因部分，把估算与商业承诺严格分开。",
      "Build a value model from a customer-approved baseline, cost drivers, and measurement period, showing formulas, sensitivity, and unattributed portions separately from commitments.",
    ],
    inputs: [
      "记录基线工时、单价、数量、质量损失、一次性投入、持续费用、汇率、假设来源和数据负责人，标注估计或实测。",
      "Record baseline hours, rates, volumes, quality loss, one-time and recurring costs, exchange rates, assumption sources, and data owners, labeling estimates versus measurements.",
    ],
    output: [
      "交付可复算的价值模型、区间与情景表、投入回收逻辑、数据缺口、复核签字点和下一步测量计划。",
      "Deliver a recalculable value model, ranges and scenarios, payback logic, data gaps, review sign-offs, and a next measurement plan.",
    ],
    risk: [
      "不得重复计算节省、把相关性写成因果或承诺固定回报；客户未确认的成本和收益只能作为假设。",
      "Do not double-count savings, turn correlation into causation, or promise a fixed return; unconfirmed costs and benefits remain assumptions.",
    ],
  },
  内部销售交接: {
    focus: [
      "把客户目标、已确认承诺、未决问题和交付依赖分开交接，以合同和审批记录为准建立实施启动门槛。",
      "Hand off customer goals, approved commitments, open questions, and delivery dependencies separately, using contracts and approvals for implementation gates.",
    ],
    inputs: [
      "整理机会编号、合同或报价版本、客户原话、范围外请求、技术约束、联系人权限、关键日期和销售—交付双方负责人。",
      "Compile opportunity ID, contract or quote version, customer wording, out-of-scope asks, technical constraints, contact permissions, key dates, and sales/delivery owners.",
    ],
    output: [
      "形成交接包、承诺与假设对照表、依赖和风险登记、客户确认问题、首次交付会议议程及签收记录。",
      "Create a handoff pack, commitments-versus-assumptions table, dependency and risk register, customer questions, kickoff agenda, and receipt record.",
    ],
    risk: [
      "销售口头说明不等同合同承诺；未被交付负责人接受的范围、日期或服务等级必须保持待确认并升级。",
      "Verbal sales statements are not contractual commitments; unaccepted scope, dates, or service levels remain pending and must escalate.",
    ],
  },
  渠道伙伴赋能: {
    focus: [
      "按伙伴角色、授权产品、转介节点、报价权限和交付支持设计可复用训练路径，区分伙伴可说内容与需内部审批内容。",
      "Design reusable training by partner role, authorized products, referral gates, pricing authority, and delivery support, separating permitted from approved content.",
    ],
    inputs: [
      "核对伙伴协议、区域和客户范围、认证状态、培训材料版本、联合品牌规范、支持联系人和信息共享同意。",
      "Check partner agreements, territories and customer scope, certification status, training versions, co-brand rules, support contacts, and sharing consent.",
    ],
    output: [
      "交付伙伴手册、角色化课程、转介流程图、可复用演示、知识测验、升级联系人和版本生效记录。",
      "Deliver a partner guide, role-based curriculum, referral flow, reusable demo, knowledge quiz, escalation contacts, and effective-version record.",
    ],
    risk: [
      "未签署或已过期的授权不得对外使用；伙伴培训完成不代表获得报价、实施或客户数据权限。",
      "Unsigned or expired authorization cannot be used externally; completing training does not grant pricing, implementation, or customer-data access.",
    ],
  },
  销售复盘分享: {
    focus: [
      "按时间线重建关键决策、客户反馈、证据和结果，区分可复制的流程改进、偶然因素与仍需验证的因果假设。",
      "Reconstruct decisions, customer feedback, evidence, and outcomes by timeline, separating repeatable process improvements, chance factors, and causal hypotheses.",
    ],
    inputs: [
      "收集机会阶段快照、会议纪要、报价和审批、客户反馈、竞争信息、行动完成情况及参与者自愿复盘意见。",
      "Gather opportunity snapshots, meeting notes, quotes and approvals, customer feedback, competitive information, action completion, and voluntary participant reflections.",
    ],
    output: [
      "形成事实时间线、有效动作与失效动作、证据等级、可复用话术、改进实验和后续复查负责人。",
      "Create a factual timeline, effective and ineffective actions, evidence levels, reusable language, improvement experiments, and review owners.",
    ],
    risk: [
      "单个输赢案例不能证明个人或话术因果；分享时去除客户机密，不把复盘假设写成正式绩效结论。",
      "One win or loss cannot prove personal or script causation; remove client confidential data and do not turn hypotheses into performance findings.",
    ],
  },
};

const CRM_PIPELINE_REVIEW_DETAILS: Readonly<Record<string, ScenarioDetail>> = {
  销售漏斗周检: {
    focus: [
      "固定本周快照、阶段定义和统计分母，先核对金额与数量再找停滞商机，把管理讨论集中到有证据的下一步。",
      "Freeze the weekly snapshot, stage definitions, and denominators, reconcile amounts and counts first, then focus management discussion on evidence-backed next actions.",
    ],
    inputs: [
      "提供快照导出时间、阶段字典、商机编号、负责人、金额币种、预计日期、最近活动和下一步字段，注明权限范围。",
      "Provide export time, stage dictionary, opportunity IDs, owners, amounts and currencies, expected dates, last activity, and next-action fields with access scope.",
    ],
    output: [
      "输出阶段数量与金额汇总、无下一步清单、停滞原因、需管理者决策项和下周复查责任人，保留源导出。",
      "Output stage count and amount totals, no-next-action list, stall reasons, management decisions, and next-week owners while retaining the source export.",
    ],
    risk: [
      "单周阶段分布不能代表转化趋势；导出范围或阶段口径变化时不得与上周直接比较，未知原因须保持未知。",
      "A single week's stage distribution is not a conversion trend; do not compare directly when scope or definitions changed, and keep unknown reasons unknown.",
    ],
  },
  预计成交日期复核: {
    focus: [
      "按历史快照统计延期次数、原预计日期与当前日期的偏差，区分客户变更、内部审批、资源阻塞和数据未更新。",
      "Use historical snapshots to count postponements and date variance, separating customer changes, internal approval, resource blockers, and stale records.",
    ],
    inputs: [
      "收集至少两期同范围快照、成交日期修改时间、负责人解释、客户确认节点、阶段和合同状态，标出缺失历史。",
      "Gather at least two same-scope snapshots, close-date edits, owner explanations, customer confirmation gates, stage, and contract state, marking missing history.",
    ],
    output: [
      "形成延期分层、日期证据链、待客户确认的时间点、需要刷新记录的队列和不应自动改写的异常项。",
      "Create postponement tiers, date evidence chains, customer dates to confirm, a refresh queue, and exceptions that must not be edited automatically.",
    ],
    risk: [
      "过期日期不等于失单或客户拒绝；时区、工作日规则和系统批量更新可能造成偏差，必须注明计算口径。",
      "An overdue date is not a lost deal or rejection; time zones, business-day rules, and batch updates can bias results and must be disclosed.",
    ],
  },
  商机阶段变动: {
    focus: [
      "用稳定商机编号和版本化阶段映射对比两期快照，分别标出推进、回退、新增、关闭和无法匹配，禁止把缺失当作没有变化。",
      "Compare snapshots with stable IDs and versioned stage mapping, separating advancement, regression, creation, closure, and unmatched records instead of treating gaps as no change.",
    ],
    inputs: [
      "准备同一筛选范围的前后快照、阶段定义版本、编号去重规则、金额币种、关闭原因和导出异常日志。",
      "Prepare before-and-after snapshots with the same filters, stage-definition versions, ID deduplication rule, amount currencies, close reasons, and export errors.",
    ],
    output: [
      "输出阶段变动桥、金额与数量变化、无法匹配记录、定义变更说明及由负责人确认的解释和行动。",
      "Output a stage-movement bridge, amount and count changes, unmatched records, definition changes, and owner-confirmed explanations and actions.",
    ],
    risk: [
      "快照时间不同或历史记录被回填会扭曲变动；不能据阶段变化推断客户意向，也不自动修正CRM原值。",
      "Different snapshot times or backfilled history can distort movement; do not infer intent or automatically modify CRM source values.",
    ],
  },
  重复商机排查: {
    focus: [
      "以账户、项目、联系人、金额和创建时间构造候选匹配规则，再由商机负责人核对业务关系，区分真实重复、拆分项目和续购。",
      "Use account, project, contact, amount, and creation-time signals to propose matches, then have owners distinguish duplicates from split projects and renewals.",
    ],
    inputs: [
      "收集稳定账户与商机编号、项目描述、创建和更新日期、负责人、金额币种、产品线、合同关联及合并权限。",
      "Collect stable account and opportunity IDs, descriptions, dates, owners, amounts and currencies, product line, contract links, and merge authority.",
    ],
    output: [
      "形成候选重复组、匹配字段与相似原因、人工结论、保留或归并建议及审计记录，不直接删除原始记录。",
      "Create candidate duplicate groups, matching fields and rationale, human decisions, retain-or-merge suggestions, and an audit trail without deleting sources.",
    ],
    risk: [
      "名称相似或金额相同不代表同一交易；误合并会丢失归因、责任和合同历史，必须保留原编号和审批。",
      "Similar names or amounts do not prove one deal; a wrong merge loses attribution, ownership, and contract history, so retain IDs and approval.",
    ],
  },
  商机字段完整性: {
    focus: [
      "按阶段配置的必填字段和业务规则检查空值、无效值及互相矛盾的字段，先统计影响再把修复任务分给责任人。",
      "Check blanks, invalid values, and contradictions against stage-specific required fields and business rules, then assign remediation after measuring impact.",
    ],
    inputs: [
      "提供字段字典、阶段必填矩阵、有效枚举、校验规则、最新快照、负责人和可修改权限，区分未知与尚未采集。",
      "Provide the field dictionary, stage-required matrix, valid enums, validation rules, latest snapshot, owners, and edit permissions, separating unknown from uncollected.",
    ],
    output: [
      "交付按严重度和阶段分组的缺失报告、示例记录、修复负责人、截止时间、复核方式与完成率定义。",
      "Deliver a severity- and stage-grouped gap report, sample records, remediation owners, deadlines, review method, and completion-rate definition.",
    ],
    risk: [
      "不能用猜测联系人、日期或概率填空；规则变更前后的缺失率不可直接比较，自动修复必须另有授权。",
      "Do not fill blanks with guessed contacts, dates, or probabilities; compare pre/post rule changes carefully and require authorization for auto-fixes.",
    ],
  },
  静默商机跟进: {
    focus: [
      "按阶段和约定工作日识别超过静默阈值的商机，结合客户暂停、内部等待、联系人变更和活动记录判断下一步。",
      "Identify opportunities past an agreed business-day threshold by stage, then consider customer pauses, internal waits, contact changes, and activity logs.",
    ],
    inputs: [
      "收集最后活动类型与时间、阶段进入日、客户约定下次联系、暂停原因、负责人、开放任务和例外名单。",
      "Collect last activity type and time, stage-entry date, customer-agreed next contact, pause reason, owner, open tasks, and exceptions.",
    ],
    output: [
      "输出静默分层、证据链接、建议联系话术、下一动作日期、负责人和不应打扰的例外说明，供人工确认发送。",
      "Output inactivity tiers, evidence links, suggested outreach, next-action date, owner, and do-not-contact exceptions for human approval.",
    ],
    risk: [
      "活动缺失可能是同步失败而非客户沉默；不得自动群发或把未回复解释为拒绝，时限规则要说明时区。",
      "Missing activity may be a sync failure, not customer silence; do not auto-send or interpret no reply as rejection, and disclose time-zone rules.",
    ],
  },
  销售预测变化: {
    focus: [
      "以同一币种和汇率口径桥接两期预测，拆分新增、推进、延期、减额、关闭和退出，并将模型计算与负责人判断分开。",
      "Bridge forecasts across periods using consistent currency and rates, splitting additions, advances, delays, reductions, closures, and exits from owner judgment.",
    ],
    inputs: [
      "准备两期预测快照、类别定义、阶段概率、币种和汇率、商机变更、关闭原因及财务确认边界。",
      "Prepare two forecast snapshots, category definitions, stage probabilities, currencies and rates, opportunity changes, close reasons, and finance boundaries.",
    ],
    output: [
      "形成预测变化桥、按类别及负责人分层、无法解释的差异队列、假设说明和下一次预测复核日期。",
      "Create a forecast-variance bridge by category and owner, an unexplained-variance queue, assumptions, and the next forecast review date.",
    ],
    risk: [
      "预测金额不是订单、回款或确认收入；概率模型、汇率和快照时点变化时必须标注不可比，不得暗示确定结果。",
      "Forecast is not an order, cash receipt, or recognized revenue; flag incomparable model, rate, or snapshot changes and avoid certainty.",
    ],
  },
  重点商机会议: {
    focus: [
      "围绕少数高影响商机准备事实、阻塞、决策请求和客户下一节点，会议中只讨论能够改变结果的行动和资源。",
      "Prepare facts, blockers, decisions, and the customer's next gate for a small set of high-impact opportunities, focusing discussion on outcome-changing actions and resources.",
    ],
    inputs: [
      "汇总最新商机快照、客户已确认需求、竞品状态、合同或采购节点、技术依赖、负责人和需要批准的资源请求。",
      "Summarize the latest snapshot, customer-confirmed needs, competitor state, contract or procurement gates, technical dependencies, owner, and resource asks.",
    ],
    output: [
      "交付一页一商机会议卡、证据与未知项、决策选项、行动责任人、截止日、客户跟进话术和会后记录入口。",
      "Deliver one-page opportunity cards, evidence and unknowns, decision options, owners, due dates, customer follow-up wording, and a post-meeting log.",
    ],
    risk: [
      "内部优先级不能冒充客户承诺；没有客户确认的时间、预算或竞争情报应标为假设并安排核验。",
      "Internal priority is not a customer commitment; unconfirmed timing, budget, or competitive intelligence must remain hypotheses with validation actions.",
    ],
  },
  商机来源分析: {
    focus: [
      "先固定来源字段、归因窗口和去重规则，再比较来源带来的商机质量、阶段推进与成本，单列未知和多触点。",
      "Fix source fields, attribution windows, and deduplication before comparing opportunity quality, progression, and cost, with unknown and multi-touch separate.",
    ],
    inputs: [
      "收集来源标签历史、活动编号、创建日期、账户去重键、阶段结果、投放成本、归因策略版本及无法识别记录。",
      "Collect source-label history, campaign IDs, creation dates, account deduplication keys, stage outcomes, spend, attribution-policy version, and unidentifiable records.",
    ],
    output: [
      "输出来源漏斗、单位有效商机成本、样本与观察期、归因不确定性和下一轮数据采集改进建议。",
      "Output a source funnel, cost per qualified opportunity, sample and observation window, attribution uncertainty, and next data-collection improvements.",
    ],
    risk: [
      "来源缺失、多个触点或短观察期会造成偏差；不要把数量高写成质量好，也不能把营销归因当作因果证明。",
      "Missing sources, multiple touches, or short windows bias results; high volume is not high quality, and attribution is not causation.",
    ],
  },
  渠道商机交接: {
    focus: [
      "用转介授权、账户归属、交接时间、重复保护和信息共享边界核对伙伴到直销的接收过程，明确未接收的责任。",
      "Review partner-to-direct handoff using referral authority, account ownership, timing, duplicate protection, and sharing boundaries, assigning unaccepted work.",
    ],
    inputs: [
      "提供伙伴协议、转介编号、账户与联系人授权、交接双方、产品范围、客户同意、状态时间线和冲突记录。",
      "Provide partner agreement, referral ID, account and contact consent, both owners, product scope, customer permission, state timeline, and conflicts.",
    ],
    output: [
      "形成渠道交接台账、接收确认、重复商机链接、信息可见范围、待客户动作及升级责任人。",
      "Create a channel handoff ledger, acceptance confirmation, duplicate links, visibility scope, pending customer actions, and escalation owner.",
    ],
    risk: [
      "未获客户同意不能共享个人或敏感商机信息；伙伴口头转交不等于直销已接收，冲突须保留双方记录。",
      "Do not share personal or sensitive opportunity data without consent; verbal referral is not direct-sales acceptance, and retain both records for conflicts.",
    ],
  },
  合同签署状态: {
    focus: [
      "将商机阶段、合同版本、审批、签署和归档事件按编号串联，明确每个状态的证据和下一位处理人，避免口头状态漂移。",
      "Link opportunity stage, contract version, approvals, signing, and archive events by ID, defining evidence and next owner for each state.",
    ],
    inputs: [
      "收集合同编号和版本、法务与财务审批、签署平台状态、签署人授权、日期、附件完整性及归档位置。",
      "Collect contract ID and version, legal and finance approvals, signing-platform state, signer authorization, dates, attachment completeness, and archive location.",
    ],
    output: [
      "输出待审批、待签署、部分签署、已完成和需人工核验列表，附证据链接、责任人、下一动作和更新时间。",
      "Output pending-approval, pending-signature, partially signed, complete, and manual-review lists with evidence links, owners, actions, and timestamps.",
    ],
    risk: [
      "草稿、口头同意或平台显示异常不能标记已签署；签署人权限和附件缺失时暂停关闭商机，不自动改变合同。",
      "Drafts, verbal agreement, or a platform anomaly are not signed status; pause closure when authority or attachments are missing and never edit contracts automatically.",
    ],
  },
  商机关闭原因复盘: {
    focus: [
      "按预先定义的赢单、失单、取消和未知分类复核关闭原因，结合客户反馈、竞品、预算和过程证据提出可验证改进假设。",
      "Review win, loss, cancellation, and unknown categories using predefined definitions, customer feedback, competition, budget, and process evidence to form testable improvements.",
    ],
    inputs: [
      "收集关闭日期、原始原因、客户原话、阶段历史、金额、来源、竞品信息、样本范围和原因字段维护记录。",
      "Collect close dates, original reasons, customer wording, stage history, amount, source, competitor information, sample scope, and reason-field maintenance records.",
    ],
    output: [
      "形成原因分布与未知率、代表性证据、分群差异、需验证的改进假设、数据修复任务和复盘会议议程。",
      "Create reason distribution and unknown rate, representative evidence, segment differences, testable improvement hypotheses, data-fix tasks, and review agenda.",
    ],
    risk: [
      "缺失原因不能归类为价格或竞品；回忆性解释可能有偏，结果只用于改进讨论，不直接用于个人问责或客户画像。",
      "Missing reasons cannot be assigned to price or competition; retrospective explanations may be biased, so use findings for improvement, not blame or profiling.",
    ],
  },
};

const BRAND_CONTENT_CALENDAR_DETAILS: Readonly<Record<string, ScenarioDetail>> = {
  月度内容日历: {
    focus: [
      "先确定月度传播目标、受众问题和内容支柱，再平衡不同渠道的主题、制作周期与团队容量，避免日历只有发布日期没有制作节奏。",
      "Set monthly communication goals, audience questions, and content pillars first, then balance themes, production cycles, and capacity across channels.",
    ],
    inputs: [
      "汇总内容支柱、重点活动、渠道时区、稿件负责人、素材和审批耗时、节假日及可用资源，标明优先级和硬性截止日。",
      "Compile pillars, campaigns, channel time zones, copy owners, asset and approval lead times, holidays, and capacity, marking priorities and fixed deadlines.",
    ],
    output: [
      "生成可筛选的月历、每周主题配比、选题简报、制作和审核节点、渠道适配清单及延期替补选题。",
      "Generate a filterable calendar, weekly theme mix, topic briefs, production and review gates, channel adaptations, and backup topics for delays.",
    ],
    risk: [
      "计划日期不等于已排程发布；素材、审批或产品事实未就绪时标为阻塞，不能用填满日历代替目标效果。",
      "Planned dates are not scheduled publication; block items missing assets, approval, or product facts, and do not equate a full calendar with impact.",
    ],
  },
  新品预热内容: {
    focus: [
      "围绕正式发布日设计悬念、问题教育、能力揭示和发布提醒的递进序列，逐条控制信息披露级别与受众行动。",
      "Sequence teaser, problem education, capability reveal, and launch reminders around the release date, controlling disclosure and audience action at each step.",
    ],
    inputs: [
      "确认发布里程碑、保密期、可公开功能清单、已批准主张、产品负责人、截图版本、区域发布时间和发布取消预案。",
      "Confirm launch milestones, embargo, approved public features and claims, product owner, screenshot version, regional timing, and cancellation fallback.",
    ],
    output: [
      "交付倒排传播节奏、各渠道短长文案、素材需求、事实核验表、发布审批人、替代文案和解除保密条件。",
      "Deliver a backward launch cadence, short and long copy by channel, asset needs, fact checks, approvers, fallback copy, and embargo-release gate.",
    ],
    risk: [
      "未经产品和法务确认不得披露路线图、价格或未发布能力；发布延期时必须同步撤下或替换已排期素材。",
      "Do not disclose roadmap, pricing, or unreleased features without approval; delay requires synchronized removal or replacement of scheduled assets.",
    ],
  },
  节日品牌内容: {
    focus: [
      "根据受众所在地区、节日背景和品牌定位决定是否参与，再设计尊重文化语境的内容形式、发布时间与非商业表达边界。",
      "Choose whether to participate based on audience region, context, and brand fit, then design culturally respectful formats, timing, and non-commercial boundaries.",
    ],
    inputs: [
      "核对节日日期与地区、文化资料来源、受众语言、品牌历史表达、图片授权、审核人和可能引发误读的表达。",
      "Check regional dates, cultural sources, audience language, brand history, image permissions, reviewers, and phrasing likely to be misunderstood.",
    ],
    output: [
      "形成参与判断、创意简报、渠道文案变体、视觉素材需求、文化敏感点检查和上线前人工审核清单。",
      "Create a participation rationale, creative brief, channel copy variants, visual needs, cultural-sensitivity check, and pre-publication review list.",
    ],
    risk: [
      "不可将节日传统简化成刻板印象或未经核实的习俗；敏感事件与节日撞期时重新评估，不因已制作而强行发布。",
      "Do not reduce traditions to stereotypes or unverified customs; reassess overlap with sensitive events rather than publishing because work is already done.",
    ],
  },
  客户故事排期: {
    focus: [
      "将客户邀约、采访、事实校核、客户审批和公开排期分成独立门槛，按客户可用时间倒排交付，不提前假定对方会同意。",
      "Separate outreach, interview, fact-check, customer approval, and publication gates, back-planning around availability without assuming consent.",
    ],
    inputs: [
      "收集客户授权联系人、可公开名称和数据范围、采访参与者、结果证据、匿名要求、审稿期限和素材制作状态。",
      "Collect authorized contacts, publishable names and metrics, interviewees, outcome evidence, anonymization rules, review deadlines, and asset state.",
    ],
    output: [
      "输出客户故事阶段表、采访提纲、证据与引用清单、客户审核版本、撤回节点和可公开素材包。",
      "Output a customer-story stage board, interview guide, evidence and quote list, customer-review version, withdrawal gates, and approved asset pack.",
    ],
    risk: [
      "客户访谈同意不自动包含公开宣传授权；未获书面确认的名称、引语、数据和商标必须从外发版本移除。",
      "Interview consent does not include publicity permission; remove names, quotes, metrics, and marks without written approval from external versions.",
    ],
  },
  多渠道内容改编: {
    focus: [
      "从已批准的核心信息出发，按平台受众、字数、画幅、链接和行动按钮要求重新编排，而不是机械缩短导致事实或限制丢失。",
      "Adapt approved core messages to audience, length, format, links, and calls to action by channel instead of mechanically shortening and losing evidence or caveats.",
    ],
    inputs: [
      "提供源稿版本、事实和引用锁定项、目标渠道规格、图片尺寸、链接追踪规则、品牌语气及各渠道审批责任人。",
      "Provide source version, locked facts and quotes, channel specifications, image sizes, link tracking, voice, and channel approvers.",
    ],
    output: [
      "交付逐渠道文案矩阵、标题与摘要、画面裁切安全区、跳转链接、核对清单和源稿至衍生稿的版本关联。",
      "Deliver a per-channel copy matrix, titles and summaries, safe crop zones, links, checks, and source-to-variant version links.",
    ],
    risk: [
      "改写不得扩大原始承诺或改变数字含义；平台尺寸和字符限制须以当前规范复核，不能仅凭旧经验套用。",
      "Rewriting must not expand commitments or change metric meaning; verify current platform specs instead of relying on stale assumptions.",
    ],
  },
  内容素材授权: {
    focus: [
      "为图片、字体、音乐、引用和用户生成内容建立来源到发布渠道的权利链，覆盖地域、期限、修改方式、署名和撤回流程。",
      "Trace rights for images, fonts, music, quotes, and user content from source to channel, covering territory, term, edits, attribution, and withdrawal.",
    ],
    inputs: [
      "登记素材编号、作者或供应方、许可文本、取得日期、适用渠道、商业用途、人物肖像同意、到期日和权利证明位置。",
      "Register asset ID, creator or vendor, license text, acquisition date, channels, commercial use, likeness consent, expiry, and proof location.",
    ],
    output: [
      "生成素材台账、允许和禁止用途、署名模板、到期提醒、待补证明队列及发布前权利审核责任。",
      "Generate an asset register, permitted and prohibited uses, attribution text, expiry reminders, missing-proof queue, and pre-publication rights owner.",
    ],
    risk: [
      "网络可访问不等于获准商用；授权不明、已到期或覆盖渠道不足的素材必须隔离，不能靠裁切或改色规避许可。",
      "Being online does not grant commercial rights; isolate unclear, expired, or insufficient licenses and never evade terms by cropping or recoloring.",
    ],
  },
  内容审核队列: {
    focus: [
      "按编辑、事实、品牌、法务与渠道审核顺序推进版本，每条意见绑定具体段落、处理状态和最终决定人。",
      "Move each version through editorial, factual, brand, legal, and channel review, linking comments to passages, resolution, and final decision owner.",
    ],
    inputs: [
      "收集内容唯一编号、当前稿版本、计划发布日、审核角色、反馈时限、事实来源、素材授权和此前退回原因。",
      "Collect content ID, current version, publication date, reviewers, response deadlines, factual sources, asset rights, and prior return reasons.",
    ],
    output: [
      "形成可排序的审核看板、未决意见、逐项修改记录、批准范围、复审责任人和可追溯的最终定稿链接。",
      "Create a sortable review board, open comments, change log, approval scope, re-review owner, and traceable final-version link.",
    ],
    risk: [
      "沉默或超时不代表批准；任何实质改稿都要确认是否重开事实或法律审核，不能覆盖旧稿和反馈记录。",
      "Silence or delay is not approval; material edits may reopen fact or legal review, and prior drafts and comments must remain traceable.",
    ],
  },
  活动传播排期: {
    focus: [
      "围绕活动报名、提醒、直播或现场、回放和会后跟进排布信息频率，协调报名截止、讲者准备和不同地区时区。",
      "Schedule registration, reminders, live or onsite, replay, and follow-up cadence around deadlines, speaker readiness, and regional time zones.",
    ],
    inputs: [
      "确认活动主办方、日期时区、报名入口、名额、讲者授权、议程版本、问答审核和取消或改期决策人。",
      "Confirm organizer, date and time zone, registration URL, capacity, speaker permissions, agenda version, Q&A review, and cancellation owner.",
    ],
    output: [
      "输出倒排传播日历、报名与提醒文案、讲者素材收集单、现场应急通知、会后内容计划和链接检查表。",
      "Output a backward promotion calendar, registration and reminder copy, speaker asset checklist, live contingency notices, follow-up content, and link checks.",
    ],
    risk: [
      "日期、名额、讲者和链接变更须全渠道同步；未经授权不得承诺录播可用或公开参会者信息。",
      "Synchronize date, capacity, speaker, and link changes across channels; do not promise a replay or disclose attendees without permission.",
    ],
  },
  员工倡导内容: {
    focus: [
      "准备员工可按个人判断选择分享的事实素材和可编辑表达，区分官方发布、个人观点、利益关系披露与内部信息边界。",
      "Provide factual assets employees may choose to share, distinguishing official announcements, personal opinions, disclosures, and confidential boundaries.",
    ],
    inputs: [
      "收集已公开信息、适用渠道、品牌可用素材、合规披露要求、员工参与原则、联系人和撤回纠错路径。",
      "Gather public facts, channels, approved assets, disclosure rules, voluntary participation principles, contacts, and correction or withdrawal paths.",
    ],
    output: [
      "交付自选文案包、事实引用卡、可替换段落、图片授权信息、常见问答和员工反馈入口。",
      "Deliver optional copy packs, fact cards, editable passages, image rights, FAQs, and an employee feedback path.",
    ],
    risk: [
      "不可虚构员工背书、强迫转发或暗示个人观点代表公司；薪酬、客户和未公开产品信息不得放入素材包。",
      "Do not fabricate endorsements, require sharing, or imply personal views represent the company; exclude pay, client, and unreleased product data.",
    ],
  },
  内容表现复盘: {
    focus: [
      "按内容目标选择可比指标和归因窗口，分别查看触达、互动、点击与转化漏斗，并结合制作投入和基线解释差异。",
      "Choose comparable metrics and attribution windows by objective, review reach, engagement, clicks, and conversion separately, and relate changes to effort and baseline.",
    ],
    inputs: [
      "提供平台导出、发布日期、受众和付费标签、内容版本、观察窗口、分母定义、预算工时及外部活动干扰。",
      "Provide platform exports, publication dates, audience and paid labels, content version, observation window, denominator, spend and hours, and external factors.",
    ],
    output: [
      "形成渠道可比性说明、分阶段指标表、成本效率、表现异常、证据限制和下一轮可测试的选题或形式假设。",
      "Create comparability notes, funnel metrics, cost efficiency, anomalies, evidence limits, and testable next-cycle topic or format hypotheses.",
    ],
    risk: [
      "曝光不等于业务转化，平台指标定义和归因不同不可直接相加；小样本与付费推广需显著披露。",
      "Impressions are not conversion, platform definitions and attribution cannot be summed blindly, and small samples or paid boosts must be disclosed.",
    ],
  },
  历史内容更新: {
    focus: [
      "按发布日期、事实变化、产品版本、失效链接和搜索价值确定更新优先级，记录修订原因并区分轻微校正与主张变化。",
      "Prioritize by age, factual changes, product version, broken links, and search value, recording why and distinguishing minor fixes from changed claims.",
    ],
    inputs: [
      "汇总现有页面与原始稿、来源日期、历史审批、当前数据、链接检查、法律声明、搜索表现和内容负责人。",
      "Collect the current page and source draft, source dates, past approvals, current data, link checks, legal notices, search performance, and owner.",
    ],
    output: [
      "输出按风险排序的更新清单、逐段修订建议、保留与删除依据、重新审批范围、更新时间和旧版归档索引。",
      "Output a risk-ranked refresh queue, passage-level edits, retain/remove rationale, reapproval scope, update date, and prior-version archive index.",
    ],
    risk: [
      "不能静默改变历史引语、数据或免责声明；重大主张变化需重新取证并重新审批，旧链接不可验证时标注。",
      "Do not silently change past quotes, metrics, or disclaimers; material claims require new evidence and review, and unverifiable links must be labeled.",
    ],
  },
  敏感事件暂停发布: {
    focus: [
      "建立事件信息核实、受影响内容盘点、建议暂停范围、决策权限和恢复条件，不让排期惯性替代对受众与品牌风险的判断。",
      "Verify incident information, inventory affected content, define pause scope, authority, and restart conditions instead of letting the calendar drive risk decisions.",
    ],
    inputs: [
      "收集已确认事件事实及更新时间、排期内容、受影响地区和受众、待发布广告、品牌风险、舆情联系人及审批人。",
      "Collect confirmed facts and timestamps, scheduled content, affected regions and audiences, queued ads, brand risks, communications contacts, and approvers.",
    ],
    output: [
      "形成待暂停与可继续清单、依据与不确定项、暂停确认记录、对外答复口径、恢复门槛和复查时间。",
      "Create pause/continue lists, rationale and unknowns, confirmation log, response lines, restart gates, and review time.",
    ],
    risk: [
      "未证实传闻不能作为事实传播；模板只提供人工决策辅助，不自动登录平台、删除排程或发布事件声明。",
      "Do not spread unverified rumors as facts; the template supports human judgment and must not log in, delete schedules, or publish statements automatically.",
    ],
  },
};

export const EXTENDED_CREATIVE_FAMILIES_B: readonly CreativeExtendedFamily[] = [
  {
    id: "recruitment-operations",
    name: ["招聘协作", "Recruitment operations"],
    category: "people",
    format: "XLSX",
    summary: [
      "协调招聘流程、候选人沟通及岗位交付",
      "Coordinate recruiting stages, candidate communication, and hiring delivery",
    ],
    style: [
      "专业、尊重候选人、保护隐私",
      "Professional, candidate-respectful, and privacy-conscious",
    ],
    sections: [
      [
        "mandate",
        "岗位与授权",
        "Role and authorization",
        "核对招聘需求、名额及决策权限。",
        "Confirm the hiring request, headcount, and decision authority.",
      ],
      [
        "funnel",
        "流程与漏斗",
        "Process and funnel",
        "定义各阶段口径、状态及转换条件。",
        "Define stages, statuses, and conversion criteria.",
      ],
      [
        "evidence",
        "评价证据",
        "Assessment evidence",
        "以岗位相关证据记录评价与分歧。",
        "Record job-related evidence and disagreements.",
      ],
      [
        "candidate",
        "候选人沟通",
        "Candidate communications",
        "安排联系人、答复时间和反馈节点。",
        "Plan contacts, response times, and feedback points.",
      ],
      [
        "exceptions",
        "异常及升级",
        "Exceptions and escalation",
        "记录延误、冲突、缺失授权及处理人。",
        "Log delays, conflicts, missing approvals, and owners.",
      ],
      [
        "handoff",
        "决定与交接",
        "Decision and handoff",
        "核对决策、待办和入职交接材料。",
        "Check decisions, outstanding actions, and onboarding handoff.",
      ],
    ],
    acceptance: [
      [
        "各阶段人员口径一致，状态与决定均有证据来源。",
        "Stage counts use consistent definitions and decisions cite evidence.",
      ],
      [
        "评价只依据岗位相关事实，未确认决定不写为录用。",
        "Assess only job-related facts; never portray an unconfirmed decision as an offer.",
      ],
      [
        "候选人资料按最小必要范围展示并设置复核责任。",
        "Minimize candidate data and assign review ownership.",
      ],
    ],
    workflow: [
      ["确认岗位授权与流程定义。", "Confirm role authorization and process definitions."],
      ["整理经授权的候选人及面试数据。", "Organize authorized candidate and interview data."],
      [
        "检查阶段积压、评价证据与沟通时点。",
        "Review stage backlog, assessment evidence, and communication dates.",
      ],
      ["与负责人核对异常并交接待办。", "Review exceptions with owners and hand over actions."],
    ],
    playbook: {
      inputs: [
        "收集已批准岗位、招聘负责人、有效招聘周期、渠道来源、候选人授权资料、阶段变更日期、面试评价和候选人沟通记录；说明各来源更新时间、去重规则与可见范围。缺少授权、评价或确定日期时列出待确认项，不补造个人信息。",
        "Collect approved roles, hiring owners, active periods, sourcing channels, authorized candidate records, stage changes, interview assessments, and communications. Record freshness, deduplication rules, and access scope; flag missing consent, assessments, or dates without inventing personal data.",
      ],
      method: [
        "以岗位和候选人去重键建立阶段台账，区分进入、退出和阶段内停留，计算漏斗时注明分母、观察窗口及重复申请处理方式。评价仅对照岗位能力与可核验证据，分歧交由授权决策人处理，不按个人敏感属性排序或自动筛除。",
        "Build a role-and-candidate stage ledger with entry, exit, and dwell times. Define funnel denominators, observation windows, and repeat applications. Assess only job-relevant evidence, route disagreements to an authorized decision maker, and never rank or exclude by sensitive traits.",
      ],
      design: [
        "工作簿分为岗位概览、候选人台账、面试安排、阶段统计和异常记录；候选人使用内部编号，输入列、公式列和状态列各有图例。冻结表头并支持筛选，日期、人数和比例采用一致格式，管理汇总仅展示所需聚合信息。",
        "Separate role overview, candidate ledger, interview schedule, stage metrics, and exceptions. Use internal candidate IDs and a legend for inputs, formulas, and statuses; freeze and filter headers, standardize dates, counts, and percentages, and limit management views to needed aggregates.",
      ],
      checks: [
        "复核各阶段人数可与明细勾稽，阶段日期不能倒置，取消或重复申请不得同时计入不同结论；抽查面试安排、反馈超期及记录权限。使用真实工具检查公式和渲染，不能重算时标注未验证，涉及录用或法律事项须由负责人确认。",
        "Reconcile stage counts to records, check date order and duplicate or cancelled applications, and sample interview schedules, overdue feedback, and access rights. Report actual formula and rendering checks; mark unavailable recalculation unverified and obtain human approval for hiring or legal decisions.",
      ],
    },
    scenarios: scenarios(
      ["招聘负责人、用人经理与招聘运营", "Recruiters, hiring managers, and recruitment operations"],
      {
        focus: [
          "按岗位和观察周期区分已发生事实、下一步动作与待确认事项，明确每项处理责任。",
          "Separate completed facts, next actions, and open questions by role and period, with an owner for each.",
        ],
        inputs: [
          "同时核对数据更新时间、候选人授权范围、负责人和招聘流程定义，缺失资料单独登记。",
          "Also check data freshness, candidate consent, owners, and stage definitions; log missing inputs.",
        ],
        output: [
          "形成可筛选的状态、责任人、时间和证据来源字段，供相关人员接续处理与复核。",
          "Provide filterable status, owner, date, and evidence fields for follow-up and review.",
        ],
        risk: [
          "个人资料仅限授权访问；不推断敏感属性，不把未批准的判断写成录用决定。",
          "Restrict access to authorized personal data, avoid sensitive inferences, and do not portray pending decisions as offers.",
        ],
      },
      [
        [
          ["招聘需求排期", "Hiring request scheduling"],
          [
            "排列多个岗位的启动先后、招聘难度与依赖。先按业务优先级和审批状态区分可启动岗位，再倒排筛选、面试及反馈节点，计算共享面试官的占用；列出岗位编号、计划日期、依赖条件和责任人，冲突或名额未确认时保留待决状态并安排复核。",
            "Sequence openings by priority, difficulty, and dependency. Separate approved openings from pending ones, back-plan screening, interviews and feedback, and check shared interviewer capacity. Record role ID, planned dates, dependencies and owners; keep conflicting or unconfirmed headcount pending for review.",
          ],
          [
            "收集岗位审批、目标到岗日、名额及面试资源。",
            "Gather approvals, target start dates, headcount, and interviewer capacity.",
          ],
          [
            "给出岗位启动日、阶段节点及资源冲突清单。",
            "Produce role start dates, stage milestones, and resource conflicts.",
          ],
          [
            "到岗时间未获业务确认时不能作为承诺。",
            "Do not promise start dates that business owners have not confirmed.",
          ],
        ],
        [
          ["招聘渠道复盘", "Sourcing channel review"],
          [
            "比较渠道带来的有效申请和后续转化。先统一岗位、观察周期和有效申请的定义，再按来源统计申请、面试及录用阶段人数，使用同一分母计算转化；标出费用归属、重复申请和无法匹配的来源，小样本与未完成流程另列，供负责人讨论续投。",
            "Compare qualified applications and downstream conversion by source. Align roles, observation windows and qualification rules, then count applications, interviews and offers using consistent denominators. Show spend attribution, duplicates, unmatched sources, small samples and incomplete journeys separately for the owner's investment review.",
          ],
          [
            "收集渠道费用、投放期间、候选人来源和阶段记录。",
            "Gather channel spend, campaign dates, candidate sources, and stage records.",
          ],
          [
            "输出各渠道漏斗、单有效申请成本及样本说明。",
            "Show channel funnels, cost per qualified application, and sample limitations.",
          ],
          [
            "小样本或归因缺失不能证明渠道优劣。",
            "Small samples or missing attribution cannot prove channel superiority.",
          ],
        ],
        [
          ["候选人阶段积压", "Candidate stage backlog"],
          [
            "识别简历、面试及决策阶段超过约定等待时间的记录。按阶段进入日期和约定工作日口径计算等待时长，区分候选人暂停、面试官缺席及决策待批；列出下一动作、负责人和计划联系日期，缺少进入时间时标为无法计算并请求补录。",
            "Identify applications exceeding agreed waiting times. Calculate age from stage entry using the agreed business-day rule; separate candidate pauses, interviewer absence and pending decisions. Record next action, owner and contact date, and flag missing entry dates as uncalculable for follow-up.",
          ],
          [
            "收集阶段进入日、服务时限、待办与当前负责人。",
            "Gather stage-entry dates, service targets, pending actions, and owners.",
          ],
          [
            "列出积压天数、跟进次序和可执行催办事项。",
            "List backlog age, follow-up priority, and actionable reminders.",
          ],
          [
            "休假、候选人主动暂停等情形不能直接算作失职。",
            "Do not equate leave or candidate-requested pauses with failure.",
          ],
        ],
        [
          ["面试官排班", "Interviewer scheduling"],
          [
            "匹配面试轮次、所需专业能力与面试官空档。逐轮记录候选人及面试官的本地日期、时间和时区，检查跨日、夏令时与重复占用；列出主面试官、候补、邀请状态和回复期限，时间有歧义或存在回避关系时暂停确认并联系协调人。",
            "Match rounds and expertise to interviewer availability. Record each participant's local date, time and time zone; check cross-day conversions, daylight saving and double bookings. List primary and backup interviewers, invitation states and reply deadlines; pause confirmation for ambiguous times or conflicts of interest.",
          ],
          [
            "收集面试时段、轮次要求、时区与回避关系。",
            "Gather time slots, round requirements, time zones, and conflicts of interest.",
          ],
          [
            "形成可调整排班、候补人员和冲突提示，并列明会议方式、地点及邀请发送状态。",
            "Produce an adjustable schedule, backups, conflict alerts, meeting format, location and invitation state.",
          ],
          [
            "不可用或未接受邀请的时段不能标记已确认。",
            "Do not mark unavailable or unaccepted slots as confirmed.",
          ],
        ],
        [
          ["面试反馈催收", "Interview feedback follow-up"],
          [
            "跟踪每轮反馈是否提交及证据是否充分。以候选人编号和轮次匹配面试记录与评价表，区分未提交、已提交待补证据及已完成；按截止时间排序，记录催办对象、最近联系和下次复查，遇评价缺项时请原面试官补充而不代写判断。",
            "Track evidence-based feedback by round. Match interviews and assessments by candidate ID and round, separating missing, submitted but incomplete, and complete feedback. Sort by deadline and record reminder owner, last contact and review date; ask the interviewer to supply missing evidence rather than writing it for them.",
          ],
          [
            "收集面试日期、评价维度、提交截止日和面试官。",
            "Gather interview dates, assessment dimensions, due dates, and interviewers.",
          ],
          [
            "输出待反馈名单、催办顺序及缺失维度，并记录预计补交日期。",
            "Produce outstanding-feedback owners, reminders, missing dimensions and expected submission dates.",
          ],
          [
            "不得替面试官编写评价或假定沉默即赞同。",
            "Never invent interviewer feedback or interpret silence as agreement.",
          ],
        ],
        [
          ["面试评价校准", "Interview assessment calibration"],
          [
            "对照统一岗位能力标准比较独立评价与分歧。先保留各轮独立评分，再逐项关联行为实例和评分标准，标识意见一致、证据不足与需讨论的差异；记录讨论主持人、待追问问题和授权决策节点，缺少同一标准时不计算汇总排名。",
            "Compare independent assessments against role criteria. Preserve each round's score, link behavioral evidence to the rubric, and distinguish agreement, insufficient evidence and differences for discussion. Record the facilitator, follow-up questions and authorized decision gate; do not rank candidates without comparable criteria.",
          ],
          [
            "收集岗位评分标准、行为证据和各轮原始反馈。",
            "Gather role rubrics, behavioral evidence, and original round feedback.",
          ],
          [
            "形成逐项证据、分歧原因和待讨论问题，保留讨论结论与未决事项。",
            "Produce criterion-level evidence, disagreements, discussion questions, conclusions and unresolved items.",
          ],
          [
            "主观印象不能替代证据，不输出自动录用结论。",
            "Impressions are not evidence and must not produce automatic hiring decisions.",
          ],
        ],
        [
          ["候选人沟通节奏", "Candidate communication cadence"],
          [
            "安排投递确认、进度更新和结果通知的联系节点。按候选人当前阶段检查上次联系和允许使用的渠道，草拟包含状态、预计更新时间和联系人但不披露未批准决定的信息；列出草稿审核人、计划发送日和未回复的复查安排，发送前核对收件人。",
            "Schedule acknowledgments, updates and outcomes. Check each candidate's stage, last contact and permitted channel; draft the status, expected update and contact without disclosing unapproved decisions. Record reviewer, planned send date and follow-up for no reply, and verify recipients before sending.",
          ],
          [
            "收集候选人偏好、已发送记录、联系人和可披露信息。",
            "Gather candidate preferences, prior messages, contacts, and permitted disclosures.",
          ],
          [
            "输出沟通日程、待办状态和可审核的消息草稿。",
            "Produce a communication calendar, action states, and reviewable drafts.",
          ],
          [
            "消息发送前须人工确认内容与接收对象。",
            "Require human confirmation of content and recipient before sending.",
          ],
        ],
        [
          ["招聘活动报名跟进", "Recruiting event follow-up"],
          [
            "追踪活动报名、实际参与和后续自愿申请。按活动和授权标识关联报名、签到与申请，分别统计人数和可联系范围，说明重复报名及未签到的处理口径；列出同意状态、负责人与联系截止日，撤回同意或来源不明时排除联系并标记待核实。",
            "Track registrations, attendance and voluntary applications. Link records by event and authorized ID, count each stage and permitted contacts, and document duplicate registrations and missing check-ins. Record consent, owner and contact deadline; exclude withdrawn or unclear consent pending verification.",
          ],
          [
            "收集活动记录、报名同意范围及后续联系偏好。",
            "Gather event records, registration consent, and contact preferences.",
          ],
          [
            "生成活动漏斗和允许联系人员的后续清单。",
            "Create an event funnel and follow-up list limited to permitted contacts.",
          ],
          [
            "参加活动不等于同意长期营销或共享简历。",
            "Event attendance does not imply consent to long-term marketing or resume sharing.",
          ],
        ],
        [
          ["录用审批追踪", "Offer approval tracking"],
          [
            "追踪拟录用方案的审批节点和反馈期限。按岗位和候选人编号核对方案版本、职级范围、审批顺序和有效期限，区分待提交、退回补充及批准完成；显示每个节点的处理人、意见和下一步，条件变动或缺少审批记录时回到复核而不发送承诺。",
            "Track approval gates and deadlines for proposed offers. Check version, grade range, approval sequence and validity by role and candidate ID; distinguish draft submission, returned revisions and approval. Show owner, decision and next action at each gate, and re-review changed terms or missing approvals before any commitment.",
          ],
          [
            "收集岗位、核准职级、薪酬区间和审批流程。",
            "Gather the role, approved grade, compensation band, and approval workflow.",
          ],
          [
            "形成审批状态、缺失材料和负责人的待办。",
            "Produce approval states, missing materials, and owner actions.",
          ],
          [
            "未获批准的薪酬或录用条件不能对候选人承诺。",
            "Do not promise compensation or offer terms before approval.",
          ],
        ],
        [
          ["候选人退出原因分析", "Candidate withdrawal analysis"],
          [
            "按自愿反馈分析退出发生阶段和已知原因。统一观察窗口和退出定义，将候选人提供的原因映射至可追溯类别并单列未知项；对照各阶段进入人数计算退出占比，标注样本量、原始反馈来源和责任人，信息不足时仅提出待验证问题。",
            "Analyze withdrawal stages and voluntarily supplied reasons. Align the observation window and withdrawal definition, map reported reasons to traceable categories, and retain unknowns. Calculate stage-level proportions against entrants and show samples, sources and owners; frame insufficient evidence as questions to validate.",
          ],
          [
            "收集退出日期、阶段、授权反馈和同期漏斗数据。",
            "Gather withdrawal dates, stages, authorized feedback, and comparable funnel data.",
          ],
          [
            "输出原因分类、样本量、改进假设和资料缺口。",
            "Show reason categories, sample sizes, improvement hypotheses, and gaps.",
          ],
          [
            "未知原因不能推断为薪酬、年龄或个人问题。",
            "Do not infer unknown causes from compensation, age, or personal circumstances.",
          ],
        ],
        [
          ["招聘供应商对账", "Recruitment vendor reconciliation"],
          [
            "核对推荐候选人、合同计费节点与供应商账单。以合同编号和授权候选人编号匹配推荐、录用及到岗记录，逐项检查计费比例、税费和保用期，计算账单与可核金额差异；列出凭证、争议原因及双方确认人，归属不明时暂停结算建议。",
            "Reconcile referrals and billing milestones against invoices. Match authorized candidate and contract IDs to referral, hiring and start records; check fees, taxes and guarantees and calculate invoice differences. List evidence, dispute reasons and both reviewers; hold settlement recommendations when ownership is unclear.",
          ],
          [
            "收集授权合同、推荐时间、录用状态和费用明细。",
            "Gather the authorized contract, referral dates, hiring status, and charges.",
          ],
          [
            "列出可核对金额、待确认条款和争议记录，并附对账日期及付款状态。",
            "List reconcilable amounts, unconfirmed terms, disputes, reconciliation dates and payment states.",
          ],
          [
            "候选人归属冲突和保用期限必须人工核实。",
            "Have humans resolve referral ownership and guarantee periods.",
          ],
        ],
        [
          ["招聘交付交接", "Hiring delivery handoff"],
          [
            "在获准录用后整理招聘向员工手续的交接。先核验最终审批、候选人同意及确认入职日期，再按最小必要原则列出材料接收方、提交方式和完成期限；对未收到的材料指定跟进人，日期变更或同意撤回时更新状态并通知原接收方停止使用。",
            "Organize recruiting-to-people-operations handoff after approval. Verify final approval, consent and confirmed start date, then list minimum-necessary recipients, transfer methods and deadlines. Assign follow-up for missing materials; update changed dates and tell recipients to stop use when consent is withdrawn.",
          ],
          [
            "收集已确认入职日期、联系人、授权材料和待办。",
            "Gather the confirmed start date, contacts, authorized materials, and actions.",
          ],
          [
            "形成交接责任表、完成状态和缺失材料清单。",
            "Produce ownership, completion states, and a missing-materials list.",
          ],
          [
            "未完成审批或撤回同意时停止共享个人材料。",
            "Stop sharing personal materials if approval or consent is absent.",
          ],
        ],
      ],
    ),
  },
  {
    id: "employee-lifecycle",
    name: ["员工手续协同", "Employee lifecycle administration"],
    category: "people",
    format: "DOCX",
    summary: [
      "为员工手续、身份变化和交接建立可执行清单",
      "Create actionable checklists for employee administration, changes, and handoffs",
    ],
    style: ["平实、尊重、强调责任与隐私", "Plain, respectful, accountable, and privacy-aware"],
    sections: [
      [
        "scope",
        "适用情形",
        "Applicability",
        "说明手续对象、触发条件与不适用范围。",
        "Define affected people, triggers, and exclusions.",
      ],
      [
        "preconditions",
        "前置资料",
        "Prerequisites",
        "列出获授权资料、流程版本及负责人。",
        "List authorized materials, policy versions, and owners.",
      ],
      [
        "steps",
        "办理步骤",
        "Procedure",
        "逐步写明动作、责任人、期限与结果。",
        "Specify actions, owners, deadlines, and outcomes step by step.",
      ],
      [
        "dependencies",
        "协作依赖",
        "Dependencies",
        "列明人力、经理、财务与信息技术交接。",
        "Describe handoffs between people operations, managers, finance, and IT.",
      ],
      [
        "exceptions",
        "异常处理",
        "Exceptions",
        "记录撤回、缺件、延期和升级渠道。",
        "Describe withdrawal, missing records, delays, and escalation.",
      ],
      [
        "closure",
        "完成与留存",
        "Closure and retention",
        "核对完成证据、资料保管及复查时间。",
        "Check completion evidence, record custody, and review dates.",
      ],
    ],
    acceptance: [
      [
        "每项手续有责任人、触发条件与完成证据。",
        "Every action has an owner, trigger, and completion evidence.",
      ],
      [
        "个人资料最小化，待确认制度与法律问题明确标记。",
        "Minimize personal data and flag unconfirmed policies and legal questions.",
      ],
      [
        "员工和相关团队知道下一步、时限及咨询渠道。",
        "Employees and teams can identify next actions, timing, and contact channels.",
      ],
    ],
    workflow: [
      ["确认场景、参与角色和生效日期。", "Confirm the scenario, participants, and effective date."],
      ["核对适用制度和必要授权。", "Check applicable policy and required authorizations."],
      ["逐步安排办理与跨团队交接。", "Sequence actions and cross-team handoffs."],
      ["由责任人核对证据并安排后续复查。", "Have owners review evidence and schedule follow-up."],
    ],
    playbook: {
      inputs: [
        "收集员工自愿提供或组织合法持有的最少必要资料、人员编号、岗位归属、关键日期、适用制度及已确认联系人；列出需要员工或管理者补充的证明，并说明资料来源、可见范围和留存期限是否已获确认，不复制身份证件或银行卡号。",
        "Gather only necessary authorized employee data, internal ID, role, key dates, applicable policy, and confirmed contacts. List missing proof and the source, visibility, and confirmed retention period; avoid copying identity documents or bank account numbers.",
      ],
      method: [
        "以事件发生前、当日和事后划分动作，分别标明员工、直属经理、人力、财务与信息技术的责任、所需授权和依赖；遇到请假、异议、撤回或系统权限未就绪时记录例外并升级，不把模板说明冒充公司制度或法律意见。",
        "Sequence actions before, on, and after the event; identify employees, managers, people operations, finance, and IT owners, authorizations, and dependencies. Escalate leave, objections, withdrawal, or unavailable access, and do not present template text as company policy or legal advice.",
      ],
      design: [
        "文档先用一页概览列出时间、参与人、联系人和办理进度，再用语义标题组织各阶段清单；步骤表按动作、责任人、期限、证据、状态排列，长说明放在表外。使用中性语气、清晰留白和可访问标题，敏感内容按最小权限展示。",
        "Begin with a one-page overview of dates, participants, contacts, and progress, then use semantic headings for stage checklists. Tables contain action, owner, due date, evidence, and state; place longer explanations outside tables, use respectful language and readable spacing, and minimize sensitive information.",
      ],
      checks: [
        "核对每项动作与真实制度版本、授权、交付时间及负责人一致，检查步骤之间的依赖、撤回处理和员工咨询渠道。检查页码、表格跨页、标题层级和资料权限；未实际完成的手续写待办，无法验证的法律与制度问题交负责人复核。",
        "Check actions against actual policy versions, permissions, dates, and owners; review dependencies, withdrawal handling, and employee contacts. Inspect pagination, table breaks, headings, and access. Keep incomplete items open and route unverified legal or policy questions to an owner.",
      ],
    },
    scenarios: scenarios(
      ["员工、直属经理与人力运营", "Employees, line managers, and people operations"],
      {
        focus: [
          "按事件前、中、后明确每个参与方的动作、前置条件和完成证据，确保员工知道下一步。",
          "Specify each party's before, during, and after actions, prerequisites, and completion evidence so the employee knows what happens next.",
        ],
        inputs: [
          "核对经授权的人员编号、制度版本、生效日期、联系人和资料范围，缺失项交由责任人确认。",
          "Confirm authorized employee IDs, policy version, effective dates, contacts, and data scope; route gaps to an owner.",
        ],
        output: [
          "交付按时间排序的手续清单、责任分工、咨询渠道和待确认事项，保留实际完成状态。",
          "Deliver a chronological checklist, ownership, support contacts, and open items with actual completion states.",
        ],
        risk: [
          "不自行作出法律、薪酬或雇佣决定；涉及个人资料的传递须限定授权和接收人。",
          "Do not independently make legal, compensation, or employment decisions; restrict personal-data transfers to authorized recipients.",
        ],
      },
      [
        [
          ["入职材料核对", "New-hire documentation"],
          [
            "核实入职前需要提供的材料与提交方式。按岗位、工作地点和清单版本逐项核对用途、格式与截止日，确认缺件由谁补充；证件号、影像和银行资料只在受控系统留痕。",
            "Verify required pre-start documents and submission methods. Check purpose, format, and deadline by role, location, and checklist version, and assign an owner for each missing item; keep identity images and banking data only in controlled systems.",
          ],
          [
            "收集材料清单、员工反馈、接收人及截止日期。",
            "Gather the required-document list, employee responses, recipients, and deadlines.",
          ],
          [
            "列出已收、待补和需要解释用途的材料。",
            "List received, missing, and purpose-to-be-explained items.",
          ],
          [
            "不得复制证件影像到无授权共享文档。",
            "Do not copy identity images to an unauthorized shared document.",
          ],
        ],
        [
          ["入职当天手续", "First-day administration"],
          [
            "安排报到、身份核验、设备领取与联系人衔接。按到场前、签到、设备、账号和培训顺序编排时间，逐项记录验证人及凭据；迟到、远程报到或设备缺货时切换备用流程。",
            "Coordinate check-in, identity verification, equipment, and contacts. Sequence pre-arrival, check-in, equipment, access, and training with a verifier and evidence for each; switch to a documented fallback for lateness, remote check-in, or shortages.",
          ],
          [
            "收集报到地点、时间、设备准备状态和接待人。",
            "Gather the check-in place, time, equipment readiness, and host.",
          ],
          [
            "生成当天时序、地点和异常联系方式。",
            "Produce a first-day timeline, locations, and exception contacts.",
          ],
          [
            "未确认的设备和系统权限不得写成已开通。",
            "Do not mark unconfirmed equipment or system access as provisioned.",
          ],
        ],
        [
          ["合同续签准备", "Contract renewal preparation"],
          [
            "跟踪合同期限、讨论安排和需审批的变更。由签署副本和制度版本倒排提醒，分别标出员工沟通、经理建议、审批和生效四个节点；日期冲突时暂不推断续约结果。",
            "Track contract terms, discussions, and changes requiring approval. Back-plan reminders from signed copies and policy versions, separating employee discussion, manager proposal, approval, and effective dates; do not infer renewal when dates conflict.",
          ],
          [
            "收集合同到期日、适用流程、审批人和沟通记录。",
            "Gather expiry dates, applicable workflow, approvers, and communications.",
          ],
          [
            "列出时间节点、双方待确认事项与交付责任。",
            "List milestones, both parties' open questions, and handoff owners.",
          ],
          [
            "不能自动推断续约、终止或法定补偿结论。",
            "Do not infer renewal, termination, or statutory compensation.",
          ],
        ],
        [
          ["部门调动交接", "Department transfer handoff"],
          [
            "安排原岗位交接和新团队接收顺序。按生效日前后拆分任务、资料、设备和权限，要求交出人与接收人分别签收；依赖方未确认时保留原责任并列出升级人。",
            "Sequence handover from the old role to the new team around the effective date. Split tasks, materials, equipment, and access, requiring acknowledgment by both parties; retain old ownership and list an escalation owner while dependencies remain unconfirmed.",
          ],
          [
            "收集生效日、双向负责人、任务清单与待交接资源。",
            "Gather the effective date, both managers, tasks, and resources to hand over.",
          ],
          [
            "形成双向交接表及未完成事项的责任归属。",
            "Produce a two-way handoff with ownership of unfinished items.",
          ],
          [
            "未批准的岗位变化和权限变更不视为已生效。",
            "Do not treat unapproved role or access changes as effective.",
          ],
        ],
        [
          ["岗位任命手续", "Role appointment administration"],
          [
            "跟踪任命文件、职责确认和通知安排。把签署、归档、系统更新和公告设为独立关卡，核对授权签发人、生效条件及受众；任一前置证据缺失就保持草稿。",
            "Track appointment documents, responsibilities, and notices. Make signature, filing, system update, and announcement separate gates; check the authorized issuer, effective conditions, and audience, keeping a draft pending when evidence is missing.",
          ],
          [
            "收集批准记录、职责说明、生效日及通知范围。",
            "Gather approvals, role responsibilities, effective date, and notification scope.",
          ],
          [
            "输出审批、签收、通知和后续交接清单。",
            "Produce approval, acknowledgment, notification, and handoff steps.",
          ],
          [
            "未经授权不得提前公布任命或承诺权限。",
            "Do not announce an appointment or promise authority before authorization.",
          ],
        ],
        [
          ["休假前工作交接", "Leave handoff"],
          [
            "安排休假期间业务代办、升级与联系边界。把事项分为休假前完成、授权代办和返岗处理，逐项写明截止日、允许动作、升级条件及失效日，不默认休假员工持续在线。",
            "Arrange coverage, escalation, and contact boundaries during leave. Classify work as due before leave, delegated, or waiting for return, recording deadlines, permitted actions, escalation triggers, and expiry dates without assuming availability.",
          ],
          [
            "收集休假区间、开放事项、代办人和授权范围。",
            "Gather leave dates, open work, backup owners, and delegated authority.",
          ],
          [
            "输出代办清单、关键截止日和紧急升级路径。",
            "Produce a coverage list, deadlines, and urgent escalation path.",
          ],
          [
            "不得要求披露医疗原因或默认休假者随时在线。",
            "Do not require medical details or assume availability during leave.",
          ],
        ],
        [
          ["休假返岗安排", "Return from leave"],
          [
            "安排返岗时间、工作状态更新与支持沟通。以员工确认的日期为基准拆分首日、首周和阶段复盘，逐项核对代办返还、设备权限和必要支持；未确认信息不写成已恢复。",
            "Coordinate return timing, updates, and support. Use the employee-confirmed date to plan day one, week one, and a review checkpoint; reconcile delegated work, equipment, and access, and do not mark recovery complete without confirmation.",
          ],
          [
            "收集已确认返岗日期、岗位联系人和未结事项。",
            "Gather the confirmed return date, contacts, and outstanding work.",
          ],
          [
            "形成分阶段交接、必要准备和跟进时间。",
            "Produce phased handback, preparation, and follow-up dates.",
          ],
          [
            "健康或个人安排只按员工同意范围处理。",
            "Handle health or personal arrangements only within employee consent.",
          ],
        ],
        [
          ["办公地点变更", "Work-location change"],
          [
            "核对地点调整对设备、座位和协作的影响。按批准地点和生效日列出工位、门禁、网络、设备及团队协作变化，分别标责任人和完成凭据；税务或劳动影响单独升级。",
            "Review the effects of a location change on equipment, seating, and collaboration. List desk, access, network, equipment, and team changes by approved location and effective date with owners and evidence; escalate tax or employment implications separately.",
          ],
          [
            "收集批准地点、时间、工位与设备需求。",
            "Gather approved locations, timing, workspace, and equipment needs.",
          ],
          [
            "列出迁移步骤、责任人与恢复工作所需条件。",
            "List move steps, owners, and conditions to resume work.",
          ],
          [
            "税务与劳动条款变化需专业人员确认。",
            "Have qualified reviewers confirm tax and employment implications.",
          ],
        ],
        [
          ["员工信息更正", "Employee record correction"],
          [
            "处理员工提出的资料更正及下游同步。先核验申请人、字段范围和授权证明，再列出需要同步的系统、顺序和回读检查；保留原值的受控审计记录，不在模板复制敏感内容。",
            "Handle employee corrections and downstream synchronization. Verify requester, field scope, and authorization, then list systems, order, and read-back checks; retain controlled audit history of the old value without copying sensitive content into the template.",
          ],
          [
            "收集更正申请、字段范围、授权证明和系统清单。",
            "Gather the request, affected fields, authorized evidence, and systems.",
          ],
          [
            "给出审核、变更、通知和复核状态清单。",
            "Provide review, change, notification, and verification statuses.",
          ],
          [
            "不得在模板中保留原始敏感资料或未经批准修改系统。",
            "Do not retain raw sensitive data or modify systems without approval.",
          ],
        ],
        [
          ["离职交接准备", "Departure handoff preparation"],
          [
            "清点在办工作、知识交接和需要关闭的权限。按离职生效时间倒排客户、项目、资料、资产和账号动作，要求经理确认每个接收人；未批准前不得提前冻结或删除。",
            "Inventory open work, knowledge handoff, and access to close. Back-plan customer, project, data, asset, and account actions from the approved departure time, with a manager-confirmed recipient for each; do not freeze or delete early.",
          ],
          [
            "收集已批准离职日期、交接负责人和资产清单。",
            "Gather the approved departure date, handoff owners, and asset inventory.",
          ],
          [
            "输出任务交接、资产归还及权限处理时间表。",
            "Produce a task handoff, asset return, and access-action timetable.",
          ],
          [
            "不得提前冻结账户或删除数据，权限动作须获授权。",
            "Do not prematurely freeze accounts or delete data; access actions require authorization.",
          ],
        ],
        [
          ["资产归还确认", "Asset return confirmation"],
          [
            "核对设备、门禁和其他借用物的归还状态。以资产编号匹配领用、归还和接收签名，区分已收、待检、损坏和遗失；发现差异时记录现场证据与复核人，不直接归责。",
            "Reconcile equipment, access cards, and borrowed assets. Match asset IDs to issue, return, and receipt signatures, distinguishing received, pending inspection, damaged, and missing; preserve evidence and a reviewer for discrepancies rather than assigning blame.",
          ],
          [
            "收集资产编号、领用记录、归还人和接收人。",
            "Gather asset IDs, issuance records, returner, and recipient.",
          ],
          [
            "列出已归还、待核验和损坏待处理项目。",
            "List returned, pending verification, and damaged items.",
          ],
          [
            "缺少签收证据不得写成已结清或认定个人责任。",
            "Do not mark items settled or assign blame without receipt evidence.",
          ],
        ],
        [
          ["离职后资料留存", "Post-departure record retention"],
          [
            "梳理离职后资料的授权保管和复查。按资料类别、来源、法定或制度依据和保管责任人建立清单，分别记录到期复核、访问审批与删除条件；期限未核实时保持待确认。",
            "Organize authorized custody and review of post-departure records. List each category, source, policy or legal basis, and custodian, with review dates, access approval, and deletion conditions; keep retention pending when the period is unverified.",
          ],
          [
            "收集资料类别、保管责任人和已确认留存制度。",
            "Gather record categories, custodians, and confirmed retention policy.",
          ],
          [
            "形成保管位置类别、访问责任和复查日期。",
            "Produce custody categories, access owners, and review dates.",
          ],
          [
            "未经核实的期限不能作为法定留存或删除依据。",
            "Unverified periods are not legal authority to retain or delete records.",
          ],
        ],
      ],
    ),
  },
  {
    id: "compensation-planning",
    name: ["薪酬与人力预算", "Compensation and workforce budgeting"],
    category: "spreadsheet",
    format: "XLSX",
    summary: [
      "以人员与薪酬驱动建立可复核的预算和情景",
      "Build auditable workforce budgets and scenarios from headcount and compensation drivers",
    ],
    style: ["审慎、结构化、敏感数据最小化", "Prudent, structured, and sensitive-data-minimizing"],
    sections: [
      [
        "scope",
        "范围与期间",
        "Scope and period",
        "明确组织、费用范围、币种和预算周期。",
        "Define organization, cost scope, currency, and budget period.",
      ],
      [
        "headcount",
        "人员驱动",
        "Headcount drivers",
        "记录期初人数、入离职和岗位变动假设。",
        "Record opening headcount and hiring, departure, and role-change assumptions.",
      ],
      [
        "compensation",
        "薪酬假设",
        "Compensation assumptions",
        "区分固定、浮动、福利及雇主成本。",
        "Separate fixed, variable, benefits, and employer costs.",
      ],
      [
        "model",
        "计算与情景",
        "Calculation and scenarios",
        "连接人员时点、假设与期间费用。",
        "Link timing and assumptions to periodic costs.",
      ],
      [
        "variance",
        "差异与敏感性",
        "Variance and sensitivity",
        "解释基线、预算和不同假设的差异。",
        "Explain differences across baseline, budget, and assumptions.",
      ],
      [
        "review",
        "审批与复核",
        "Approval and review",
        "记录未决口径、访问范围和审批状态。",
        "Record open definitions, access scope, and approval status.",
      ],
    ],
    acceptance: [
      [
        "人员数量与费用按期间、组织及币种可追溯。",
        "Headcount and costs are traceable by period, organization, and currency.",
      ],
      [
        "假设与公式分离，零分母、时间边界及敏感性已检查。",
        "Assumptions and formulas are separated, with denominator, timing, and sensitivity checks.",
      ],
      [
        "预算不冒充已批准薪酬、法律结论或实际付款。",
        "Budgets do not imply approved pay, legal conclusions, or actual payments.",
      ],
    ],
    workflow: [
      ["确认范围、授权及成本口径。", "Confirm scope, authorization, and cost definitions."],
      ["整理人员驱动和可追溯假设。", "Organize workforce drivers and traceable assumptions."],
      [
        "建立期间计算、情景及差异桥。",
        "Build periodic calculations, scenarios, and variance bridges.",
      ],
      ["复核敏感信息、公式与审批状态。", "Review sensitive data, formulas, and approvals."],
    ],
    playbook: {
      inputs: [
        "收集经授权的组织与岗位人数、雇佣形式、预算期间、入离职时间、薪资区间、奖金规则、福利、雇主成本、历史实际及财务科目映射；记录来源版本、币种、单位与生效日。没有授权时使用汇总或匿名数据，缺失假设明确留空。",
        "Collect authorized workforce counts by organization and role, employment type, period, start and departure dates, salary bands, incentive rules, benefits, employer costs, actuals, and account mappings. Record sources, currency, units, and effective dates; use aggregates or anonymous data when authorization is absent.",
      ],
      method: [
        "按人员或岗位及月份建立驱动，区分在岗人数、平均人数与预算编制，按实际生效日和批准规则计算固定薪酬、奖金及雇主成本。分别建立基准和可调整情景，解释汇率与跨期影响，不重复计算福利，也不将预测当成员工的承诺薪资。",
        "Model by employee or role and month, distinguishing active, average, and budgeted headcount. Apply effective dates and approved rules to fixed pay, incentives, and employer costs; build adjustable scenarios, explain currency and timing effects, avoid double counting, and never present forecasts as promised pay.",
      ],
      design: [
        "工作簿设置口径说明、人数驱动、薪酬假设、月度计算、预算汇总和差异分析表；输入格与公式格清晰区分，人员明细按最小权限或匿名编号管理。每个汇总标明期间、币种和单位，冻结表头并提供可复核的公式及异常提示。",
        "Create methodology, headcount drivers, pay assumptions, monthly calculations, budget summary, and variance sheets. Clearly distinguish inputs and formulas, protect or anonymize employee detail, label periods, currencies, and units, and provide frozen headers, traceable formulas, and exception flags.",
      ],
      checks: [
        "复核期初加净变动等于期末、月度累计等于年度汇总，抽查入离职跨月、奖金重复、零值和汇率影响；将关键假设与批准记录逐项核对。按可用环境进行公式与重算检查，不能验证时注明，涉及薪酬政策和劳动法规须人工复审。",
        "Reconcile opening headcount plus movements to closing headcount and months to annual totals; sample partial-month starts, duplicate incentives, zeros, and currency effects. Check assumptions against approvals, disclose unavailable recalculation, and obtain human review of pay policy and employment law.",
      ],
    },
    scenarios: scenarios(
      [
        "人力预算负责人、财务规划与授权管理者",
        "Workforce planners, finance, and authorized managers",
      ],
      {
        focus: [
          "以人员驱动、期间假设和预算责任为主线，明确计算边界与需要授权人判断的差异。",
          "Use workforce drivers, period assumptions, and budget ownership to frame calculations and decisions requiring approval.",
        ],
        inputs: [
          "同时记录数据来源、日期、币种、科目映射和批准状态，人员明细按授权最小化使用。",
          "Record data sources, dates, currency, account mappings, and approval states while minimizing authorized employee detail.",
        ],
        output: [
          "提供输入假设、可追溯公式、期间汇总、差异解释与待确认项，支持责任人复核。",
          "Provide input assumptions, traceable formulas, period totals, variance explanations, and open items for owner review.",
        ],
        risk: [
          "预测不等于薪酬承诺或实付，未确认制度不得直接采用；个人薪资须限制可见范围。",
          "Forecasts are neither pay commitments nor payments; do not assume unconfirmed policy and restrict salary visibility.",
        ],
      },
      [
        [
          ["年度人力成本预算", "Annual workforce cost budget"],
          [
            "预测年度在岗人数和各项人工成本。按部门和月份拆分期初人数、入职、离职、薪资、奖金与福利，先锁定批准基线再建立情景；检查期末人数等于期初加净变动，并由预算责任人确认假设。",
            "Forecast annual headcount and workforce cost components. Split opening headcount, starts, exits, pay, incentives, and benefits by department and month; lock the approved baseline before scenarios, reconcile closing headcount, and obtain owner confirmation.",
          ],
          [
            "收集部门编制、工资基线、招聘计划和福利假设。",
            "Gather department positions, pay baseline, hiring plans, and benefits assumptions.",
          ],
          [
            "按月展示人数、费用、年度总计和预算责任。",
            "Show monthly headcount, costs, annual totals, and budget ownership.",
          ],
          [
            "未批准的新岗位不得视为确定支出。",
            "Do not treat unapproved positions as committed spending.",
          ],
        ],
        [
          ["新增岗位成本测算", "New position cost estimate"],
          [
            "测算新增岗位从计划入职至年底的增量成本。分别计算完整月和入职月的部分月成本，列出薪资、雇主税费与福利假设；对入职提前或延后一个月做敏感性并标记批准岗位。",
            "Estimate incremental cost from planned start through year end. Separate full-month and partial-start costs, listing pay, employer charges, and benefits; run one-month early or late sensitivities and mark which positions are approved.",
          ],
          [
            "收集岗位数量、起薪区间、计划入职月和雇主成本。",
            "Gather positions, starting pay ranges, planned start months, and employer costs.",
          ],
          [
            "给出分月费用、假设区间和年度增量。",
            "Provide monthly costs, assumption ranges, and annual increment.",
          ],
          [
            "预计入职日期变化会影响成本，须单列敏感性。",
            "Show sensitivity to changes in planned start dates.",
          ],
        ],
        [
          ["调薪预算情景", "Salary adjustment scenarios"],
          [
            "比较不同调薪比例和生效月份的预算影响。先固定适用人群和基线，再分别计算生效月前后费用与雇主成本，展示低、中、高情景及预算余量；不得把模型结果写成个人决定。",
            "Compare budget effects of adjustment rates and effective months. Fix the eligible population and baseline, calculate pre- and post-effective costs and employer charges, and show low, base, and high scenarios with remaining budget; do not turn model output into individual decisions.",
          ],
          [
            "收集薪酬基线、适用人群、候选比例及预算上限。",
            "Gather pay baseline, eligible groups, candidate rates, and budget cap.",
          ],
          [
            "给出基准、低高情景及与预算上限的差额。",
            "Show base, low and high scenarios and the gap to the budget cap.",
          ],
          [
            "预算情景不得被描述为个人已获批准调薪。",
            "Do not describe a budget scenario as an approved individual raise.",
          ],
        ],
        [
          ["奖金计提预测", "Bonus accrual forecast"],
          [
            "按经批准的奖金规则估计期间计提。以绩效周期和已批准目标为边界，分开目标、预计达成和已计提金额，核对累计计提不超过规则上限；绩效未确认时只给情景区间并列审批人。",
            "Estimate periodic accruals under approved rules. Bound the model by performance period and approved targets, separating target, expected attainment, and accrued amounts; check the cap and show scenarios plus the approver while performance is unconfirmed.",
          ],
          [
            "收集绩效周期、目标奖金、达成率和已计提余额。",
            "Gather performance periods, target incentives, attainment, and existing accruals.",
          ],
          [
            "输出月度计提、累计余额和规则说明。",
            "Produce monthly accruals, cumulative balances, and rule notes.",
          ],
          [
            "绩效未确定时只能提供情景，不能认定应付额。",
            "Use scenarios while performance is unknown; do not assert amounts payable.",
          ],
        ],
        [
          ["雇主福利成本", "Employer benefits cost"],
          [
            "分项估算员工福利和雇主承担成本。按地区、员工类别和缴费基数拆分保险、社保、补贴等项目，记录费率生效日和上限；对政策缺口标出来源、复核人及暂用假设。",
            "Estimate benefits and employer-paid costs by component. Split insurance, contributions, and allowances by region, worker type, and base, recording rate dates and caps; flag policy gaps with source, reviewer, and temporary assumptions.",
          ],
          [
            "收集适用地区、人数、已确认费率与缴费基数。",
            "Gather applicable locations, headcount, confirmed rates, and contribution bases.",
          ],
          [
            "展示各地区、费用类别和期间的测算。",
            "Show estimates by location, cost category, and period.",
          ],
          [
            "费率与上限需核对最新政策及当地专业意见。",
            "Verify rates and caps against current policy and local professional advice.",
          ],
        ],
        [
          ["岗位空缺成本", "Vacancy cost analysis"],
          [
            "比较岗位空缺时的薪酬节余与临时代班成本。按空缺起止日计算未发生薪酬，再关联加班、外包和服务损失等已确认支出；展示毛节余、替代成本和净差异，并注明不可转用预算。",
            "Compare vacancy salary savings with temporary coverage costs. Calculate avoided pay by vacancy dates and link confirmed overtime, contractors, and service impacts; show gross saving, substitute cost, and net difference, noting budget that cannot be redeployed.",
          ],
          [
            "收集空缺起止、预算薪资、加班或外包实际费用。",
            "Gather vacancy dates, budgeted pay, and actual overtime or contractor costs.",
          ],
          [
            "形成节余、替代支出和净差异的期间桥。",
            "Produce a period bridge for savings, substitute spend, and net variance.",
          ],
          [
            "空缺不一定产生等额现金节余或可转用预算。",
            "A vacancy does not automatically create equivalent cash savings or reusable budget.",
          ],
        ],
        [
          ["人员流动成本", "Workforce turnover costs"],
          [
            "分析离职、补招与交接相关的成本构成。以匿名汇总区分招聘费、培训工时、交接损失和空缺期，说明计量公式与观察窗口；成本证据不足时列出不可量化项，不将个人原因写入预算。",
            "Analyze departure, replacement, and handoff costs. Use anonymous aggregates to separate recruiting, training hours, handoff loss, and vacancy periods, stating formulas and windows; list unquantified items when evidence is weak and omit individual reasons.",
          ],
          [
            "收集经授权的离职人数、招聘费用和培训支出。",
            "Gather authorized departure counts, recruiting spend, and training costs.",
          ],
          [
            "输出成本分类、计量方法与无法量化部分。",
            "Show cost categories, measurement methods, and unquantified items.",
          ],
          [
            "不得用相关性推断个人离职原因或虚构损失。",
            "Do not infer individual reasons or invent losses from correlations.",
          ],
        ],
        [
          ["部门人员预算滚动预测", "Department workforce rolling forecast"],
          [
            "用最新实际更新剩余月份的人员与费用预测。冻结已结账月份，逐项记录招聘批准、入离职时间和假设变更，比较原预算、上次预测与当前预测；实际与预测重叠时先修正期间边界。",
            "Update remaining-month headcount and costs using latest actuals. Lock closed months, record approved hiring, start or exit dates, and changed assumptions, then compare budget, prior forecast, and current forecast; fix overlapping periods first.",
          ],
          [
            "收集月度实际、已批准招聘变动和剩余期假设。",
            "Gather monthly actuals, approved hiring changes, and remaining-period assumptions.",
          ],
          [
            "对比原预算、上次预测、本次预测及变动原因。",
            "Compare original budget, prior forecast, current forecast, and reasons.",
          ],
          [
            "实际与预测期间不能重叠计入同一月份。",
            "Do not count actuals and forecasts in the same month.",
          ],
        ],
        [
          ["地区薪酬汇率影响", "Currency effects on regional payroll"],
          [
            "分离当地工资变化与汇率变化造成的差异。以同一期间的原币实际、恒定汇率和报告币种分别计算，标明汇率来源和取值日；用差异桥核对工资因素、汇率因素与四舍五入余额。",
            "Separate local-pay changes from exchange effects. Calculate local actuals, constant-rate results, and reporting currency for the same period, recording source and date; reconcile pay, FX, and rounding through a variance bridge.",
          ],
          [
            "收集原币成本、记账币种、期间汇率及汇率来源。",
            "Gather local-currency costs, reporting currency, period rates, and sources.",
          ],
          [
            "输出原币、统一汇率及实际汇率的对照。",
            "Show local-currency, constant-rate, and actual-rate comparisons.",
          ],
          [
            "未经确认的汇率不能用于声称已结算金额。",
            "Do not present unconfirmed exchange rates as settled amounts.",
          ],
        ],
        [
          ["兼职与工时预算", "Part-time and hours budget"],
          [
            "统一统计期间和全职工时基准；预算工时÷同期间全职工时得到预算人员当量，实际工时÷同期间全职工时得到实际人员当量，不混用。时薪仅用于计算工资费用；基准缺失或为零时标记无法计算。工时和加班按适用规则复核，不将合法排班或个体差异直接认定违规。",
            "Use the same reporting period and full-time hours baseline. Calculate budget FTE as budget hours divided by full-time hours for that period, and actual FTE as actual hours divided by full-time hours for that period; do not mix the two. Use hourly rates only for wage costs. Mark FTE uncalculable if the baseline is missing or zero. Review hours and overtime under applicable rules without treating lawful schedules or individual differences as violations.",
          ],
          [
            "收集合同工时、预算排班、实际工时、时薪和同期间全职工时基准。",
            "Gather contracted hours, budgeted rosters, actual hours, hourly rates, and the full-time hours baseline for the same period.",
          ],
          [
            "分列预算和实际工时、人员当量及对应工资费用。",
            "Show budget and actual hours, FTE, and corresponding wage costs separately.",
          ],
          [
            "人员当量不能替代法定工时及加班合规判断，合法排班或个体差异不直接构成违规。",
            "FTE does not replace legal working-time and overtime review; lawful schedules and individual differences are not violations by themselves.",
          ],
        ],
        [
          ["人力预算差异归因", "Workforce budget variance bridge"],
          [
            "拆解人数、入职时点、薪资和奖金造成的差异。固定预算与实际的期间和币种，按人数、时间、单价、奖金及汇率顺序做桥接，检查各因素之和等于总差异；方法变更需在注释中说明。",
            "Decompose headcount, timing, pay, incentives, and FX variance. Fix periods and currency, bridge volume, timing, rate, incentive, and FX effects in order, and reconcile the factors to the total; disclose method changes in notes.",
          ],
          [
            "收集同口径预算、实际、人员变动及已批准调整。",
            "Gather comparable budgets, actuals, workforce movements, and approved adjustments.",
          ],
          [
            "形成可勾稽的差异桥和责任人解释。",
            "Produce a reconcilable variance bridge and owner explanations.",
          ],
          [
            "归因方法变化必须披露，避免因素重复计算。",
            "Disclose changes in attribution and prevent double counting.",
          ],
        ],
        [
          ["薪酬预算审批跟踪", "Compensation budget approval tracking"],
          [
            "追踪预算版本、审批意见与授权状态。为每版记录创建人、时间、来源、金额和差异摘要，按提交、退回、批准、替换顺序保留版本链；审批人未确认前限制导出和下发。",
            "Track versions, comments, and authorization. Record creator, time, source, amount, and variance summary for each version, retaining a chain of submitted, returned, approved, and superseded states; restrict export before approval.",
          ],
          [
            "收集版本号、预算金额、审批节点及反馈。",
            "Gather version IDs, amounts, approval gates, and feedback.",
          ],
          [
            "输出版本差异、待审批事项及决策记录。",
            "Produce version differences, pending approvals, and decision records.",
          ],
          [
            "草案不得当作已批准方案或下发个人薪酬。",
            "Do not present a draft as approved or issue individual pay decisions.",
          ],
        ],
      ],
    ),
  },
  {
    id: "team-capacity",
    name: ["排班与产能", "Team scheduling and capacity"],
    category: "operations",
    format: "XLSX",
    summary: [
      "平衡任务需求、实际可用工时和服务覆盖",
      "Balance workload, available capacity, and service coverage",
    ],
    style: ["直观、务实、便于调整", "Practical, scannable, and easy to adjust"],
    sections: [
      [
        "demand",
        "需求与范围",
        "Demand and scope",
        "明确业务量、期间和服务要求。",
        "Define workload, period, and service requirements.",
      ],
      [
        "availability",
        "人员与可用时间",
        "People and availability",
        "记录可用工时、技能和已知限制。",
        "Record available hours, skills, and known constraints.",
      ],
      [
        "capacity",
        "产能模型",
        "Capacity model",
        "计算有效产能并注明假设。",
        "Calculate effective capacity and document assumptions.",
      ],
      [
        "schedule",
        "排班安排",
        "Schedule",
        "安排任务、时段、责任人与备份。",
        "Assign tasks, time slots, owners, and backups.",
      ],
      [
        "gaps",
        "缺口与例外",
        "Gaps and exceptions",
        "识别冲突、覆盖缺口和超载。",
        "Identify conflicts, coverage gaps, and overload.",
      ],
      [
        "review",
        "确认与调整",
        "Confirmation and adjustment",
        "保留审批、变更和后续复核。",
        "Retain approvals, changes, and follow-up reviews.",
      ],
    ],
    acceptance: [
      [
        "需求、可用工时与排班可逐时段核对。",
        "Demand, availability, and assignments reconcile by time slot.",
      ],
      [
        "冲突、缺口和待审批加班可见且有责任人。",
        "Conflicts, gaps, and pending overtime have visible owners.",
      ],
      [
        "请假和个人限制按授权处理，不以预测冒充承诺。",
        "Handle leave and individual constraints with authorization, and distinguish forecasts from commitments.",
      ],
    ],
    workflow: [
      ["确认需求粒度及覆盖规则。", "Confirm demand grain and coverage rules."],
      ["收集可用时间、技能及已批准休假。", "Gather availability, skills, and approved leave."],
      ["制定排班并核查冲突和缺口。", "Draft assignments and check conflicts and gaps."],
      [
        "与负责人确认后发布及追踪变更。",
        "Confirm with owners before publishing and tracking changes.",
      ],
    ],
    playbook: {
      inputs: [
        "收集服务时间、任务数量、历史处理时长、所需技能、人员可用工时、已批准休假、班次规则、交接要求与地点时区；注明需求预测和实际排班的来源版本。没有可确认的工时或资格时标记缺口，不自行推断员工健康及个人安排。",
        "Collect service hours, task volumes, historical handling times, required skills, available hours, approved leave, shift rules, handover needs, locations, and time zones. Record versions for demand forecasts and schedules; flag unknown availability or qualifications without inferring health or personal circumstances.",
      ],
      method: [
        "按实际业务需要的日期和时段对齐需求量、单项处理时间、技能及可用人数，扣除已确认休假与非生产时间后计算有效产能；检查跨班、连续工作、交接和关键岗位覆盖。对缺口提出可选调整并标明审批，禁止把估算效率当成员工绩效。",
        "Align volume, handling time, skills, and available people by the required day and time slot. Deduct confirmed leave and nonproductive time, then check consecutive shifts, handovers, and key-role coverage. Offer gap remedies with approval needs; do not use estimated efficiency as individual performance.",
      ],
      design: [
        "设置需求、人员可用性、技能矩阵、排班、产能汇总和冲突表；每行使用稳定人员或班次编号，输入与公式分开并附文字图例。冻结表头，日期时间和时区各占独立列并检查夏令时与跨日，周末和休假用文字配合颜色，避免仅靠红绿区分状态。",
        "Separate demand, availability, skills, schedules, capacity summaries, and conflicts. Use stable IDs, distinguish inputs and formulas, and freeze headers. Store dates and time zones in separate columns, check daylight-saving and cross-day transitions, and pair colors with text for weekends and leave.",
      ],
      checks: [
        "核对人员同一时段不重复分配、关键班次覆盖、休假与工作量不冲突，检查跨日计算和每周总工时；差异归属具体责任人。对公式及实际重算结果分别记录，涉及工时、休息和加班的规定需按所在地及组织制度人工核对。",
        "Check for double booking, key-shift coverage, leave conflicts, cross-midnight calculations, and weekly hours; assign each exception an owner. Record formula and recalculation results separately and have local working-time, rest, and overtime rules reviewed by a responsible person.",
      ],
    },
    scenarios: scenarios(
      ["排班负责人、一线主管和业务运营", "Schedulers, frontline leads, and operations"],
      {
        focus: [
          "结合真实需求、人员可用性和岗位覆盖，明确每个时间段的安排、缺口与待审批调整。",
          "Combine real demand, staff availability, and role coverage to identify each period's assignments, gaps, and adjustments awaiting approval.",
        ],
        inputs: [
          "核对日期时区、任务口径、可用工时、岗位技能和已批准休假，并标注预测来源及更新时间。",
          "Check dates and time zones, workload definitions, available hours, role skills, and approved leave; record forecast sources and freshness.",
        ],
        output: [
          "给出可筛选排班、产能对照、冲突清单及责任人，保留版本和实际确认状态供调整。",
          "Provide filterable schedules, demand-versus-capacity comparisons, conflicts, owners, versions, and confirmation states.",
        ],
        risk: [
          "不得自动批准加班或忽略休息要求；个人信息按授权展示，缺失数据不得伪装为完整覆盖。",
          "Do not approve overtime automatically or ignore rest requirements; restrict personal data and never hide gaps caused by missing data.",
        ],
      },
      [
        [
          ["周班次排班", "Weekly shift roster"],
          [
            "安排一周各班次并平衡岗位覆盖。按岗位最低人数生成每日缺口，再检查员工可用时段、连续工时和休息间隔；未确认的调班保留原安排，逐项列出替补与审批人。",
            "Assign a week's shifts while balancing role coverage. Calculate daily gaps against minimum staffing, then check availability, consecutive hours, and rest intervals; retain the original roster for unapproved swaps and list backups and approvers.",
          ],
          [
            "收集班次时段、岗位需求、员工可用性与休假。",
            "Gather shift times, role demand, availability, and leave.",
          ],
          [
            "列出每日班表、候补与待处理冲突。",
            "Produce daily rosters, backups, and unresolved conflicts.",
          ],
          [
            "连续班次和个人不可用时间须人工确认。",
            "Have people review consecutive shifts and unavailable periods.",
          ],
        ],
        [
          ["客服高峰覆盖", "Peak customer-support coverage"],
          [
            "按小时预测咨询量并安排客服覆盖。用到达量和平均处理时长换算负荷，按服务目标预留波动缓冲，再将渠道技能映射至当班人员；峰值缺口须列明候补和主管决策时间。",
            "Forecast inquiries hourly and schedule support. Convert arrivals and handling time into workload, reserve variability buffer against service targets, and map channel skills to staff; list backups and decision deadlines for peak gaps.",
          ],
          [
            "收集历史到达量、服务时长和渠道时段。",
            "Gather historical arrivals, handling times, and channel hours.",
          ],
          [
            "展示高峰缺口、候补和响应目标。",
            "Show peak gaps, backup coverage, and response targets.",
          ],
          [
            "平均处理时间不能保证全部请求按时完成。",
            "Average handling time does not guarantee every request meets target.",
          ],
        ],
        [
          ["项目资源分配", "Project resource allocation"],
          [
            "对照项目里程碑分配团队可用工时。按任务依赖先锁定关键路径和所需技能，再比较每人剩余工时与承诺量；超载项给出可延后任务和待确认的交付影响，不直接改承诺日期。",
            "Allocate team hours against milestones. Map dependencies and critical skills first, then compare remaining capacity with commitments; for overload, show deferrable work and delivery impact for review without changing promised dates.",
          ],
          [
            "收集项目任务、预计工时、依赖和人员技能。",
            "Gather project tasks, estimated hours, dependencies, and skills.",
          ],
          [
            "输出个人及项目负载与跨项目冲突。",
            "Show individual and project load plus cross-project conflicts.",
          ],
          [
            "估时未经确认不能承诺交付日期。",
            "Unconfirmed estimates cannot establish a promised delivery date.",
          ],
        ],
        [
          ["节假日值守", "Holiday coverage"],
          [
            "安排节假日关键岗位与升级联系人。逐日检查最低服务人数、经批准意愿和应急替补，并预留交接窗口；补偿规则、跨日归属及尚未接受的邀请分别标记待确认。",
            "Schedule essential roles and escalation contacts over holidays. Check minimum daily coverage, approved preferences, and backups with handoff windows; flag compensation rules, cross-day allocation, and unaccepted invitations for confirmation.",
          ],
          [
            "收集服务需求、假期意愿、批准规则和应急名单。",
            "Gather service needs, holiday preferences, approval rules, and emergency contacts.",
          ],
          [
            "给出值守表、替补和异常升级路径。",
            "Produce a duty roster, backups, and exception escalation paths.",
          ],
          [
            "值守安排及补偿需经负责人和适用制度确认。",
            "Have owners confirm coverage and compensation under applicable policy.",
          ],
        ],
        [
          ["跨时区交接", "Cross-time-zone handover"],
          [
            "识别跨地区班次重叠窗口与交接责任。分别保存每地本地日期时间及IANA时区，再转换共同时间；检查夏令时切换日的不存在或重复时刻、跨午夜日期和节假日，歧义时由当地负责人确认。",
            "Identify overlap windows and handover ownership. Store each local date/time with its IANA time zone before conversion; check nonexistent or repeated daylight-saving times, midnight crossings, and holidays, obtaining local confirmation for ambiguity.",
          ],
          [
            "收集所在地时区、工作时间、夏令时及待办。",
            "Gather local time zones, working hours, daylight changes, and open work.",
          ],
          [
            "展示本地时间、共同时间和交接清单。",
            "Show local and shared times with a handover checklist.",
          ],
          [
            "夏令时变化和跨日日期须逐项校对。",
            "Individually verify daylight-saving changes and cross-date conversions.",
          ],
        ],
        [
          ["产能缺口预测", "Capacity gap forecast"],
          [
            "比较未来需求预测与有效可用产能。以低、中、高需求和实际可排工时建立区间，扣除休假、培训和服务缓冲后计算缺口周；列出假设变动对缺口的影响，避免将预测误作订单事实。",
            "Compare forecast demand with effective future capacity. Model low, base, and high demand against schedulable hours after leave, training, and service buffers; show sensitivity by week and never present forecasts as actual orders.",
          ],
          [
            "收集订单量、处理时间、人员供给及不确定区间。",
            "Gather orders, handling times, staffing supply, and uncertainty ranges.",
          ],
          [
            "输出周度缺口、假设及可选补救方案。",
            "Produce weekly gaps, assumptions, and alternative mitigations.",
          ],
          [
            "预测区间不是已发生工作量，不能省略假设。",
            "Forecast ranges are not actual workload and require stated assumptions.",
          ],
        ],
        [
          ["会议与深度工作安排", "Meetings and focus capacity"],
          [
            "核对固定会议对项目可用工时的影响。按周汇总固定会、准备时间与跨时区时段，再与已确认任务承诺比较；提出可合并或异步处理的会议清单，由会议负责人决定，不把空白日历自动算成可用产能。",
            "Assess how recurring meetings affect project capacity. Sum recurring meetings, preparation, and cross-time-zone slots by week against confirmed commitments; suggest sessions for consolidation or async handling for owner review, without treating calendar gaps as capacity.",
          ],
          [
            "收集会议时长、参会人员、任务承诺和工作日。",
            "Gather meeting durations, attendees, task commitments, and working days.",
          ],
          [
            "显示会议占用、可用时段和建议调整。",
            "Show meeting load, available time, and proposed adjustments.",
          ],
          [
            "不应假设日历空白即代表员工可接受更多工作。",
            "An empty calendar does not imply capacity for additional work.",
          ],
        ],
        [
          ["技能覆盖矩阵", "Skill coverage matrix"],
          [
            "检查关键任务是否有合格主责与后备。以任务要求逐项匹配已验证技能、当前授权和可用时段，标记无人覆盖、仅一人掌握或证书到期情形；培训建议须对应具体缺口并指定复查日期。",
            "Check whether critical work has qualified primary and backup owners. Match requirements to verified skills, current authority, and availability; flag uncovered work, single-person dependencies, and expiring credentials, with training linked to gaps and review dates.",
          ],
          [
            "收集经确认的技能、授权范围和可用时间。",
            "Gather confirmed skills, authority, and availability.",
          ],
          [
            "输出岗位覆盖矩阵、单点和培训需求。",
            "Produce a coverage matrix, single points of failure, and training needs.",
          ],
          [
            "不得凭岗位名称虚构资格或个人能力评级。",
            "Do not invent qualifications or individual ratings from job titles.",
          ],
        ],
        [
          ["调班申请跟踪", "Shift-change requests"],
          [
            "跟踪换班申请及交接后的覆盖变化。记录原班与拟换班的日期、时区、岗位和两方确认，再重算岗位覆盖、工时及休息间隔；任一审批未完成就保留原表并说明冲突原因。",
            "Track shift swaps and coverage effects. Record original and proposed dates, time zones, roles, and both parties' consent, then recalculate coverage, hours, and rest; retain the original roster until all approvals pass and explain conflicts.",
          ],
          [
            "收集原班次、申请人、拟替班人和批准状态。",
            "Gather original shifts, requester, proposed replacement, and approval state.",
          ],
          [
            "展示申请队列、冲突检查和批准记录。",
            "Show the request queue, conflict checks, and approvals.",
          ],
          [
            "双方未确认或未批准前保持原班表。",
            "Keep the original roster until both parties and approvers confirm.",
          ],
        ],
        [
          ["请假覆盖安排", "Leave coverage planning"],
          [
            "为已批准休假安排任务代理与交接。只登记经确认的休假日期和必要工作交接，按截止日匹配有权限代理人，并明确可处理范围、客户告知责任及权限失效日；不得记录休假原因。",
            "Arrange coverage for approved leave. Record only confirmed dates and essential handoffs, match deadlines to authorized backups, and define task scope, customer notice owner, and access expiry without recording leave reasons.",
          ],
          [
            "收集休假日期、未结任务、授权和可用代理。",
            "Gather leave dates, open tasks, delegated authority, and available backups.",
          ],
          [
            "列出代理、截止日和休假结束后的返还事项。",
            "List backups, deadlines, and handback items after leave.",
          ],
          [
            "避免在共享排班表记录请假原因。",
            "Avoid recording reasons for leave in a shared roster.",
          ],
        ],
        [
          ["突发缺勤应对", "Unexpected absence response"],
          [
            "在缺勤后识别当班关键工作与替代人员。以岗位和服务等级筛出必须连续运行的任务，联系已授权候补并记录接单状态；未获确认的替班、加班或客户承诺放入主管决策队列。",
            "Identify essential work and replacements after an unexpected absence. Prioritize continuity-critical tasks by role and service level, contact authorized backups, and record acceptance; queue unconfirmed coverage, overtime, or customer commitments for a supervisor.",
          ],
          [
            "收集受影响时段、岗位、可联系候补与未结事项。",
            "Gather affected shifts, roles, reachable backups, and open work.",
          ],
          [
            "输出临时覆盖、待决定缺口及升级顺序。",
            "Provide temporary coverage, undecided gaps, and escalation order.",
          ],
          [
            "不推断缺勤原因，替班和加班必须确认。",
            "Do not infer absence reasons; confirm replacement and overtime.",
          ],
        ],
        [
          ["排班公平性复核", "Roster distribution review"],
          [
            "比较夜班、周末和节假日班次分布。先按适用规则定义可比班次和统计周期，再对照可用性与历史安排显示人均次数及偏差；说明豁免依据，并把争议交负责人复核而非自动评分。",
            "Compare night, weekend, and holiday shifts. Define comparable shifts and periods under applicable rules, then show assignments per person against availability and history; state exception bases and route disputes for review instead of scoring automatically.",
          ],
          [
            "收集历史班表、适用规则和员工自愿偏好。",
            "Gather historical rosters, applicable rules, and voluntary preferences.",
          ],
          [
            "展示分布差异、例外说明及讨论问题。",
            "Show distribution differences, documented exceptions, and discussion points.",
          ],
          [
            "公平判断须结合可用性，不据敏感属性作结论。",
            "Consider availability and do not draw conclusions from sensitive attributes.",
          ],
        ],
      ],
    ),
  },
  {
    id: "customer-success",
    name: ["客户成功", "Customer success"],
    category: "operations",
    format: "DOCX",
    summary: [
      "围绕客户目标、使用、风险与行动组织持续服务",
      "Organize ongoing service around customer goals, adoption, risks, and actions",
    ],
    style: ["客户导向、事实清晰、沟通克制", "Customer-centered, factual, and measured"],
    sections: [
      [
        "objectives",
        "客户目标",
        "Customer outcomes",
        "记录客户确认的目标和衡量口径。",
        "Record customer-confirmed goals and measures.",
      ],
      [
        "baseline",
        "现状与证据",
        "Baseline and evidence",
        "整理服务范围、实际使用与反馈。",
        "Summarize service scope, actual usage, and feedback.",
      ],
      [
        "progress",
        "进展与价值",
        "Progress and value",
        "对照目标呈现进度与可验证结果。",
        "Present progress and verifiable outcomes against goals.",
      ],
      [
        "issues",
        "问题与风险",
        "Issues and risks",
        "列出障碍、影响、严重程度和责任人。",
        "List blockers, impacts, severity, and owners.",
      ],
      [
        "actions",
        "行动计划",
        "Action plan",
        "区分双方责任、期限和完成定义。",
        "Separate each party's owners, dates, and completion criteria.",
      ],
      [
        "followup",
        "跟进与确认",
        "Follow-up and confirmation",
        "说明下次沟通、待确认事项与资料边界。",
        "State the next meeting, unresolved items, and information boundaries.",
      ],
    ],
    acceptance: [
      [
        "客户目标和结论对应有日期的真实证据。",
        "Customer goals and findings map to dated evidence.",
      ],
      [
        "行动项明确双方负责人、时限及完成条件。",
        "Actions name both parties' owners, dates, and completion criteria.",
      ],
      [
        "风险或续约状态不由缺失数据推断。",
        "Do not infer risk or renewal status from missing data.",
      ],
    ],
    workflow: [
      ["确认客户目标及授权资料。", "Confirm customer goals and authorized materials."],
      ["整理使用、反馈和交付证据。", "Organize usage, feedback, and delivery evidence."],
      ["讨论差距并制定双方行动。", "Discuss gaps and agree on joint actions."],
      ["核实对外措辞并跟踪承诺。", "Review external wording and track commitments."],
    ],
    playbook: {
      inputs: [
        "收集客户确认的目标、合同服务范围、上线和培训记录、约定指标、使用数据、工单、会议纪要及决策联系人；标明日期、样本范围和资料访问授权。缺少客户确认或数据时记录未知，不把销售预测或内部推测写成客户承诺。",
        "Collect customer-confirmed goals, contracted scope, launch and training records, agreed metrics, usage data, tickets, meeting notes, and decision contacts. Record dates, sample coverage, and access permissions; flag missing confirmation instead of treating sales forecasts or internal guesses as customer commitments.",
      ],
      method: [
        "先核对目标和服务范围，再对照可观察的采用、使用深度、交付状态与客户反馈分析差距；区分服务问题、培训障碍、客户自身依赖和仍待验证的假设。每个建议对应可执行动作、双方负责人、截止日及客户确认节点。",
        "Check objectives and scope first, then compare adoption, usage depth, delivery status, and customer feedback. Separate service issues, training barriers, customer dependencies, and hypotheses requiring validation. Link each recommendation to an action, both parties' owners, due date, and customer confirmation.",
      ],
      design: [
        "首页简洁呈现客户目标、当前状态和需要共同决定的事项；正文以目标进展、证据、问题、行动及下次检查组织，表格只包含实际所需字段。采用客户可理解的语言、分级标题和适量留白，客户敏感信息及内部判断按受众分别控制。",
        "Open with customer goals, status, and joint decisions; organize the body by progress, evidence, issues, actions, and next review. Use only necessary table fields, customer-friendly language, semantic headings, and whitespace; control customer-sensitive information and internal judgments according to audience.",
      ],
      checks: [
        "将每个数字和承诺对照来源、范围、日期及合同，核实客户意见并检查行动负责人和完成标准；没有数据不设虚假的健康分。检查文档页码、长表分页和隐私可见范围；未实际完成培训、解决或续约的事项不得写为已完成。",
        "Verify each number and commitment against source, scope, date, and contract; confirm customer views, action owners, and completion criteria. Never invent health scores for missing data. Inspect pagination, long tables, and privacy, and do not claim training, resolution, or renewal is complete without evidence.",
      ],
    },
    scenarios: scenarios(
      [
        "客户成功经理、客户业务负责人和交付团队",
        "Customer success managers, client business owners, and delivery teams",
      ],
      {
        focus: [
          "以客户确认目标和服务范围为依据，区分真实进展、阻碍、双方责任和需要共同决定的事项。",
          "Use customer-confirmed goals and service scope to separate actual progress, blockers, mutual responsibilities, and joint decisions.",
        ],
        inputs: [
          "核对资料日期、合同边界、使用口径、客户反馈和授权，缺失的信息列为待确认而非猜测。",
          "Check dates, contract boundaries, usage definitions, customer feedback, and permissions; flag missing information instead of guessing.",
        ],
        output: [
          "交付可分享的证据摘要、行动清单、双方责任人及下次检查时间，明确当前状态。",
          "Deliver a shareable evidence summary, action list, mutual owners, next review date, and current status.",
        ],
        risk: [
          "不虚构客户收益、服务承诺或续约概率；敏感信息与内部判断须按受众和授权控制。",
          "Do not invent customer benefits, service commitments, or renewal probabilities; restrict sensitive data and internal judgments by audience and authorization.",
        ],
      },
      [
        [
          ["客户启动准备", "Customer kickoff preparation"],
          [
            "梳理上线前客户目标、团队和交付依赖。",
            "Clarify customer goals, teams, and delivery dependencies before launch.",
          ],
          [
            "收集合同范围、实施计划、联系人和启动条件。",
            "Gather contracted scope, implementation plan, contacts, and kickoff prerequisites.",
          ],
          [
            "形成启动议程、责任矩阵与待确认清单。",
            "Produce a kickoff agenda, responsibility matrix, and open questions.",
          ],
          [
            "未经授权不要承诺合同之外的交付。",
            "Do not promise delivery beyond the contract without authorization.",
          ],
        ],
        [
          ["客户上线检查", "Customer launch readiness"],
          [
            "检查上线条件、培训准备和支持渠道。",
            "Review launch prerequisites, training readiness, and support channels.",
          ],
          [
            "收集验收记录、未解决问题及上线决策人。",
            "Gather acceptance records, unresolved issues, and the launch decision owner.",
          ],
          [
            "列出已验证、待完成和阻塞上线的事项。",
            "List verified, outstanding, and launch-blocking items.",
          ],
          [
            "测试记录缺失时不得声称上线已获验收。",
            "Do not claim launch acceptance when test evidence is missing.",
          ],
        ],
        [
          ["客户采用计划", "Customer adoption plan"],
          [
            "按用户群识别产品启用和日常使用障碍。",
            "Identify activation and everyday-use barriers by user group.",
          ],
          [
            "收集授权使用统计、培训记录和访谈反馈。",
            "Gather authorized usage metrics, training records, and interview feedback.",
          ],
          [
            "给出分人群行动、负责人和观察周期。",
            "Provide actions, owners, and observation windows by group.",
          ],
          ["登录次数不能单独证明业务价值。", "Login counts alone do not prove business value."],
        ],
        [
          ["客户培训跟进", "Customer training follow-up"],
          [
            "跟踪培训覆盖、练习结果和后续支持。",
            "Track training coverage, practice outcomes, and follow-up support.",
          ],
          [
            "收集课程名单、出席记录、练习反馈与问题。",
            "Gather course rosters, attendance, practice feedback, and questions.",
          ],
          [
            "列出已培训人群、未覆盖项和补训计划。",
            "List trained groups, coverage gaps, and make-up sessions.",
          ],
          [
            "参加培训不等于熟练掌握，需实际评估。",
            "Attendance does not prove proficiency without assessment.",
          ],
        ],
        [
          ["客户业务回顾", "Customer business review"],
          [
            "对照商定目标回顾一段时期内的成果。",
            "Review outcomes over a period against agreed objectives.",
          ],
          [
            "收集基线、期间指标、案例和客户确认意见。",
            "Gather baselines, period metrics, cases, and customer-confirmed feedback.",
          ],
          [
            "形成目标进展、证据、问题与下阶段行动。",
            "Produce goal progress, evidence, issues, and next-period actions.",
          ],
          [
            "不能把相关变化无证据归因于本产品。",
            "Do not attribute correlated changes to the product without evidence.",
          ],
        ],
        [
          ["低活跃客户跟进", "Low-activity customer follow-up"],
          [
            "识别约定口径下使用下降及其待验证原因。",
            "Identify reduced usage under agreed definitions and hypotheses to test.",
          ],
          [
            "收集期间活跃数据、服务中断和客户反馈。",
            "Gather period activity, service interruptions, and customer feedback.",
          ],
          [
            "提供核实问题、联系计划及支持选项。",
            "Provide validation questions, contact plans, and support options.",
          ],
          [
            "低活跃不直接等于流失或客户不满意。",
            "Low activity does not automatically mean churn or dissatisfaction.",
          ],
        ],
        [
          ["重点问题升级", "Critical issue escalation"],
          [
            "汇总客户高影响问题及跨团队处置。",
            "Summarize high-impact customer issues and cross-team response.",
          ],
          [
            "收集事件时间、影响范围、工单与处置状态。",
            "Gather incident times, scope of impact, tickets, and response status.",
          ],
          [
            "输出影响摘要、负责人、更新节奏和待定事项。",
            "Produce impact, owners, update cadence, and open issues.",
          ],
          [
            "恢复时间未确认时不能给出确定承诺。",
            "Do not promise a recovery time that has not been confirmed.",
          ],
        ],
        [
          ["客户需求反馈", "Customer request feedback"],
          [
            "整理客户需求的业务背景及已有替代方案。",
            "Capture business context and alternatives for customer requests.",
          ],
          [
            "收集原始表述、使用场景、影响及提出时间。",
            "Gather the original request, scenario, impact, and date.",
          ],
          [
            "形成可供产品评审的问题和证据记录。",
            "Produce reviewable problem statements and evidence for product teams.",
          ],
          ["内部评审不等于承诺进入产品路线图。", "Internal review is not a roadmap commitment."],
        ],
        [
          ["服务范围调整", "Service scope change"],
          [
            "梳理新增或缩减服务对双方的影响。",
            "Describe the impact of added or reduced services on both parties.",
          ],
          [
            "收集现有合同、变更申请、资源和时间限制。",
            "Gather the current contract, change request, resources, and timing constraints.",
          ],
          [
            "列出变化、依赖、审批及沟通计划。",
            "List changes, dependencies, approvals, and communications.",
          ],
          [
            "没有签署变更前不能视作合同已修改。",
            "Do not treat an unsigned change as a contract amendment.",
          ],
        ],
        [
          ["续约准备", "Renewal preparation"],
          [
            "总结服务价值、遗留问题与客户决策时间。",
            "Summarize service value, open issues, and the customer's decision timeline.",
          ],
          [
            "收集合同到期日、交付证据、未结工单及沟通记录。",
            "Gather contract expiry, delivery evidence, open tickets, and communications.",
          ],
          [
            "形成续约准备清单及双方待确认问题。",
            "Produce a renewal-preparation checklist and mutual open questions.",
          ],
          [
            "不得推断客户意向或把报价草案当成已接受。",
            "Do not infer customer intent or treat draft pricing as accepted.",
          ],
        ],
        [
          ["客户联系人交接", "Customer contact handover"],
          [
            "交接客户关系背景、当前事项和沟通偏好。",
            "Hand over relationship context, current matters, and communication preferences.",
          ],
          [
            "收集经授权联系人、待办、会议记录和服务范围。",
            "Gather authorized contacts, actions, meeting notes, and service scope.",
          ],
          [
            "形成交接摘要、待办责任及客户通知草稿。",
            "Produce a handoff summary, action ownership, and a customer-notification draft.",
          ],
          [
            "不要共享未经授权的个人联系方式或内部评价。",
            "Do not share unauthorized personal contact details or internal assessments.",
          ],
        ],
        [
          ["客户终止服务交接", "Customer service closure"],
          [
            "安排服务结束、资料交接与未结问题处理。",
            "Plan service closure, data handoff, and outstanding issues.",
          ],
          [
            "收集合同终止条件、双方联系人、资料及时间表。",
            "Gather contract termination terms, contacts, data, and timeline.",
          ],
          [
            "输出终止清单、确认节点与剩余责任。",
            "Produce a closure checklist, confirmation gates, and remaining responsibilities.",
          ],
          [
            "不得自行删除客户数据或宣称合同义务已结清。",
            "Do not delete customer data or claim contractual obligations are discharged without authorization.",
          ],
        ],
      ],
      CUSTOMER_SUCCESS_DETAILS,
    ),
  },
  {
    id: "sales-enablement",
    name: ["销售赋能", "Sales enablement"],
    category: "marketing",
    format: "PPTX",
    summary: [
      "为销售人员提供有证据、有边界的客户沟通材料",
      "Equip sellers with evidence-backed, appropriately bounded customer materials",
    ],
    style: ["清楚、可信、面向客户问题", "Clear, credible, and customer-problem-led"],
    sections: [
      [
        "audience",
        "受众与目标",
        "Audience and goal",
        "说明客户角色、场景及本次沟通目标。",
        "Identify customer roles, scenario, and meeting goal.",
      ],
      [
        "problem",
        "客户问题",
        "Customer problem",
        "区分已确认问题与需要提问的假设。",
        "Separate confirmed problems from questions to validate.",
      ],
      [
        "value",
        "价值与方案",
        "Value and approach",
        "将实际能力映射到客户任务。",
        "Map actual capabilities to customer tasks.",
      ],
      [
        "proof",
        "证据与案例",
        "Evidence and cases",
        "使用有授权且适用的事实和案例。",
        "Use authorized, relevant facts and cases.",
      ],
      [
        "objections",
        "疑问与边界",
        "Questions and boundaries",
        "准备回应、限制及需要升级的问题。",
        "Prepare responses, limitations, and escalation questions.",
      ],
      [
        "next",
        "下一步",
        "Next steps",
        "明确双方行动及确认时间。",
        "Specify mutual actions and confirmation dates.",
      ],
    ],
    acceptance: [
      [
        "产品表述、客户证据与授权范围一致。",
        "Product claims and customer evidence match actual authorization.",
      ],
      [
        "每页传达一个明确观点并适合实际沟通。",
        "Each slide conveys one clear point for its intended use.",
      ],
      [
        "价格、合规和交付承诺均须经相关负责人确认。",
        "Pricing, compliance, and delivery commitments require responsible-owner confirmation.",
      ],
    ],
    workflow: [
      ["确认受众、业务问题和沟通时长。", "Confirm audience, problem, and meeting duration."],
      ["核对产品材料和可公开证据。", "Verify product materials and shareable evidence."],
      ["设计叙事、问答与下一步。", "Develop the narrative, questions, and next step."],
      ["审核外发措辞并检查逐页呈现。", "Review external claims and inspect each slide."],
    ],
    playbook: {
      inputs: [
        "收集目标客户及其角色、已确认的业务问题、产品能力和版本、获授权的案例或研究、竞争信息来源、价格审批范围及预期沟通时长；明确公开资料、内部资料和客户专有信息的使用权限。缺少客户目标或产品证据时先列问题，不虚构收益。",
        "Gather customer roles, confirmed business problems, product capabilities and versions, authorized cases or research, competitive sources, pricing authority, and meeting duration. Separate public, internal, and customer-confidential material; ask about missing objectives or proof rather than inventing benefits.",
      ],
      method: [
        "先用客户任务组织叙事，逐一连接已确认问题、相关能力、可核验证据和适用条件；对未经核实的需求形成开放式问题，准备常见异议及诚实回应。价格、交付、保障与竞品判断需引用已批准信息，无法支持的主张删除或标为待确认。",
        "Organize the narrative around customer jobs, connecting confirmed problems, relevant capabilities, verifiable evidence, and conditions. Prepare open questions and honest responses to objections; use approved pricing, delivery, security, and competitive information, removing or flagging unsupported claims.",
      ],
      design: [
        "按沟通时长安排封面、问题、能力、证据、疑问和下一步，每页一个结论，数据选择合适图表并标注来源及时间。使用可编辑图形和统一版式、足够字号和留白；讲者提示与正文分开，截图须展示真实获准产品状态。",
        "Match the deck to meeting length with an opening, problem, capability, evidence, questions, and next steps. Use one conclusion per slide, appropriate charts with sources and dates, editable objects, consistent readable layouts, separate speaker notes, and authorized real product screenshots.",
      ],
      checks: [
        "逐页核对功能可用性、案例使用许可、数据口径和证据时效，检查报价与合同边界并由业务负责人审批；不要把未完成的试点或认证写为成功。生成后检查对象、文字裁切、备注、阅读顺序与渲染结果，无法检查时明确列出。",
        "Verify feature availability, case permissions, metric definitions, and evidence currency on every slide; obtain approval for pricing and contractual claims. Do not claim incomplete pilots or certifications succeeded. Inspect objects, clipping, notes, reading order, and rendered pages, disclosing unavailable checks.",
      ],
    },
    scenarios: scenarios(
      [
        "销售人员、客户决策人和销售支持",
        "Salespeople, customer decision makers, and sales support",
      ],
      {
        focus: [
          "围绕客户实际任务建立问题、适用能力、证据和下一步之间的关系，区分已确认事实与假设。",
          "Connect the customer's actual job to the relevant problem, capability, evidence, and next step; distinguish facts from hypotheses.",
        ],
        inputs: [
          "核对产品版本、目标受众、资料授权、证据时间及审批范围，缺少信息时列出需要确认的问题。",
          "Check product version, audience, content permissions, evidence dates, and approval authority; list questions where information is missing.",
        ],
        output: [
          "形成可编辑的演示内容、适当的讲者备注和清晰行动请求，便于销售人员按客户情况调整。",
          "Deliver editable slides, appropriate speaker notes, and a clear action request that sellers can adapt to the customer.",
        ],
        risk: [
          "不得虚构客户案例、能力、价格或效果；对外材料及合同承诺必须经过授权人员审核。",
          "Do not invent customer cases, capabilities, pricing, or outcomes; authorized owners must review external material and contractual commitments.",
        ],
      },
      [
        [
          ["首次客户会面", "First customer meeting"],
          [
            "设计以了解客户目标为主的初次沟通。",
            "Design an initial meeting focused on understanding customer goals.",
          ],
          [
            "收集已知背景、参会角色和会议时间。",
            "Gather known context, attendee roles, and meeting time.",
          ],
          [
            "输出开场、探索问题及后续行动页。",
            "Provide an opening, discovery questions, and next-step slide.",
          ],
          [
            "未经确认的痛点不能当作客户事实。",
            "Do not treat unconfirmed pain points as customer facts.",
          ],
        ],
        [
          ["需求发现访谈", "Discovery interview"],
          [
            "围绕现状、影响和决策过程准备开放问题。",
            "Prepare open questions about current state, impact, and decision process.",
          ],
          [
            "收集行业背景、已有线索及可访谈角色。",
            "Gather industry context, existing leads, and available interview roles.",
          ],
          [
            "形成问题顺序、追问提示及记录页。",
            "Produce question order, follow-up prompts, and a notes page.",
          ],
          [
            "避免诱导客户认可预设结论。",
            "Avoid leading the customer to endorse a predetermined conclusion.",
          ],
        ],
        [
          ["产品能力演示", "Product capability demonstration"],
          [
            "按客户任务展示真实产品操作链。",
            "Demonstrate the real product workflow around a customer task.",
          ],
          [
            "收集已上线功能、演示环境及演示数据授权。",
            "Gather available features, demo environment, and demo-data permissions.",
          ],
          [
            "输出演示脚本、关键截图和替代方案。",
            "Provide a demo script, key screenshots, and fallback plan.",
          ],
          [
            "演示环境故障时不得伪称功能已验证。",
            "Do not claim a feature was verified when the demo environment fails.",
          ],
        ],
        [
          ["行业场景介绍", "Industry use-case overview"],
          [
            "将行业工作流程与适用产品能力对应。",
            "Map an industry workflow to applicable product capabilities.",
          ],
          [
            "收集公开行业资料、实际能力及已授权案例。",
            "Gather public industry material, real capabilities, and authorized cases.",
          ],
          [
            "形成场景流程、价值假设和证据页。",
            "Produce a workflow, value hypotheses, and supporting evidence.",
          ],
          [
            "行业通用问题不能冒充客户已经确认的需求。",
            "Do not present general industry issues as customer-confirmed needs.",
          ],
        ],
        [
          ["客户案例讲解", "Customer case presentation"],
          [
            "讲清案例背景、实施条件和实际结果。",
            "Explain the case context, implementation conditions, and actual outcomes.",
          ],
          [
            "收集客户授权、统计口径、时间和可公开素材。",
            "Gather customer permission, metric definitions, dates, and approved assets.",
          ],
          [
            "输出挑战、行动、结果及限制的案例页。",
            "Produce case slides covering challenge, action, outcome, and limits.",
          ],
          [
            "案例结果不能保证其他客户取得同样效果。",
            "A case result does not guarantee the same outcome for other customers.",
          ],
        ],
        [
          ["常见异议应答", "Common objection responses"],
          [
            "准备关于成本、迁移和实施的常见问题。",
            "Prepare for common questions on cost, migration, and implementation.",
          ],
          [
            "收集真实异议、已批准答复及专家联系人。",
            "Gather actual objections, approved responses, and expert contacts.",
          ],
          [
            "输出提问、证据、回答和升级条件。",
            "Provide questions, evidence, responses, and escalation conditions.",
          ],
          [
            "未知问题应升级，不得编造确定答案。",
            "Escalate unknowns rather than inventing certain answers.",
          ],
        ],
        [
          ["竞争方案比较", "Competitive option comparison"],
          [
            "以客户决策标准比较可核实的方案差异。",
            "Compare verifiable option differences against customer decision criteria.",
          ],
          [
            "收集公开资料、版本日期和客户关注标准。",
            "Gather public sources, version dates, and customer criteria.",
          ],
          [
            "提供比较表、证据来源及未验证项目。",
            "Provide a comparison table, evidence sources, and unverified items.",
          ],
          [
            "不贬损竞品，不将缺失资料解释为功能不存在。",
            "Do not disparage competitors or equate missing evidence with missing capability.",
          ],
        ],
        [
          ["试点范围讨论", "Pilot scope discussion"],
          [
            "明确试点目标、工作范围与验证方式。",
            "Clarify pilot goals, work scope, and validation methods.",
          ],
          [
            "收集候选场景、参与人、期限和资源限制。",
            "Gather candidate use cases, participants, duration, and resource constraints.",
          ],
          [
            "形成试点范围、成功标准及双方责任草案。",
            "Produce draft pilot scope, success criteria, and mutual responsibilities.",
          ],
          [
            "试点成功标准和费用需双方确认后生效。",
            "Pilot success criteria and costs require mutual confirmation.",
          ],
        ],
        [
          ["商业价值论证", "Business value discussion"],
          [
            "比较现状成本与候选方案的可测量影响。",
            "Compare baseline costs with measurable candidate-solution effects.",
          ],
          [
            "收集客户提供的基线、计量方法及成本假设。",
            "Gather customer-provided baselines, measurement methods, and cost assumptions.",
          ],
          ["展示公式、取值区间及不确定性。", "Show formulas, value ranges, and uncertainty."],
          [
            "估算收益不是承诺回报，不得重复计数。",
            "Estimated benefits are not guaranteed returns and must not be double counted.",
          ],
        ],
        [
          ["内部销售交接", "Internal sales handoff"],
          [
            "向交付团队转交客户目标和已承诺事项。",
            "Transfer customer goals and approved commitments to delivery teams.",
          ],
          [
            "收集会议纪要、合同范围、联系人及待决问题。",
            "Gather meeting notes, contract scope, contacts, and open questions.",
          ],
          [
            "提供交付依赖、责任人与风险清单。",
            "Provide delivery dependencies, owners, and a risk list.",
          ],
          [
            "内部猜测必须与合同承诺分开标注。",
            "Clearly distinguish internal assumptions from contractual commitments.",
          ],
        ],
        [
          ["渠道伙伴赋能", "Channel partner enablement"],
          [
            "说明伙伴可销售范围和客户转介流程。",
            "Explain the partner's permitted sales scope and referral workflow.",
          ],
          [
            "收集伙伴协议、授权产品、培训与支持资料。",
            "Gather the partner agreement, authorized products, training, and support materials.",
          ],
          [
            "输出伙伴流程、边界和可联系专家。",
            "Provide the partner workflow, boundaries, and expert contacts.",
          ],
          [
            "未签署权限不得作为伙伴对外承诺。",
            "Do not present unsigned authority as a partner commitment.",
          ],
        ],
        [
          ["销售复盘分享", "Sales learning review"],
          [
            "复盘商机推进中的有效动作和关键失误。",
            "Review effective actions and missteps during an opportunity.",
          ],
          [
            "收集时间线、客户反馈、团队决策及结果。",
            "Gather the timeline, customer feedback, team decisions, and outcome.",
          ],
          [
            "形成事实、经验、改进动作和复查点。",
            "Produce facts, lessons, improvements, and review points.",
          ],
          [
            "单一案例不能证明因果，不应归咎个人。",
            "A single case cannot prove causation or justify personal blame.",
          ],
        ],
      ],
      SALES_ENABLEMENT_DETAILS,
    ),
  },
  {
    id: "crm-pipeline-review",
    name: ["商机与 CRM 治理", "Opportunity and CRM governance"],
    category: "spreadsheet",
    format: "XLSX",
    summary: [
      "统一商机阶段口径、预测和数据质量",
      "Unify opportunity stages, forecasts, and data quality",
    ],
    style: [
      "可追溯、可筛选、管理判断透明",
      "Traceable, filterable, and transparent about judgment",
    ],
    sections: [
      [
        "definitions",
        "范围与口径",
        "Scope and definitions",
        "定义商机、期间、阶段和金额口径。",
        "Define opportunity, period, stage, and amount.",
      ],
      [
        "source",
        "数据来源",
        "Data sources",
        "记录导出时间、字段、权限及责任人。",
        "Record export time, fields, permissions, and owners.",
      ],
      [
        "pipeline",
        "商机明细",
        "Opportunity detail",
        "追踪阶段、金额、预期日期与下一步。",
        "Track stage, amount, expected date, and next step.",
      ],
      [
        "forecast",
        "预测与变化",
        "Forecast and movements",
        "区分预测、确认收入与阶段变动。",
        "Separate forecasts, confirmed revenue, and stage movement.",
      ],
      [
        "quality",
        "数据质量",
        "Data quality",
        "识别重复、缺失、过期和口径冲突。",
        "Identify duplicates, missing fields, stale data, and inconsistent definitions.",
      ],
      [
        "actions",
        "处理与复核",
        "Remediation and review",
        "分配修正责任并保留复核状态。",
        "Assign remediation owners and retain review status.",
      ],
    ],
    acceptance: [
      [
        "商机明细、阶段汇总与预测分母一致并可勾稽。",
        "Opportunity details, stage totals, and forecast denominators reconcile.",
      ],
      [
        "重复与过期项为待核实提示，不自动删除或改写。",
        "Duplicates and stale items are review flags, not automatic deletions or edits.",
      ],
      [
        "预测金额和概率不冒充已签合同或确认收入。",
        "Forecast amounts and probabilities are not signed contracts or recognized revenue.",
      ],
    ],
    workflow: [
      ["核对导出范围、权限与口径。", "Confirm export scope, permissions, and definitions."],
      ["识别质量问题并保留原始记录。", "Identify quality issues while retaining source records."],
      ["汇总阶段变化和预测差异。", "Summarize stage movements and forecast variances."],
      [
        "由商机负责人确认修正和下一步。",
        "Have opportunity owners confirm corrections and next actions.",
      ],
    ],
    playbook: {
      inputs: [
        "收集经授权的商机导出、账户与联系人标识、负责人、阶段、金额和币种、预计成交日期、上次活动、下一步及对应合同状态；记录导出时间、筛选条件、阶段定义和来源系统。无法核实的字段保留空值，个人联系信息按权限最小化。",
        "Collect authorized opportunity exports, account and contact IDs, owners, stages, amounts and currencies, expected close dates, last activity, next actions, and contract states. Record export time, filters, stage definitions, and source system; retain unknowns and minimize personal contact data.",
      ],
      method: [
        "以稳定商机编号去重，对比连续快照识别新增、推进、延期、丢失及金额变化；按明确分母计算阶段转化和预测，历史阶段不全时禁止倒推出完整漏斗。对缺失字段、长期无活动和疑似重复生成待核实列表，不自动更改CRM或推断成交概率。",
        "Deduplicate on stable opportunity IDs and compare successive snapshots for creation, progression, postponement, loss, and amount changes. Define denominators for conversions and forecasts, and never reconstruct a complete funnel from missing history. Flag gaps, inactivity, and suspected duplicates without changing CRM or inferring win probability.",
      ],
      design: [
        "工作簿分原始快照、字段字典、商机台账、阶段汇总、预测变化及数据质量队列；原始列与计算列清晰区分，金额、币种、日期和百分比使用正确类型。冻结表头、提供筛选和口径说明，管理汇总避免暴露不必要的个人联系信息。",
        "Separate raw snapshots, data dictionary, opportunity ledger, stage summary, forecast movements, and quality queue. Distinguish source and calculated columns; use typed amounts, currencies, dates, and percentages, frozen headers, filters, and definitions while limiting personal contact information.",
      ],
      checks: [
        "核对商机数量及金额与源导出一致，检查跨币种汇总、重复编号、过期预计日期、零分母和快照期间差异；阶段转换与责任人解释须保留证据。记录公式、重算及权限核查实际结果，预测未被批准时不得宣称已确认或已回款。",
        "Reconcile opportunity counts and amounts to source exports; check currencies, duplicate IDs, stale close dates, zero denominators, and snapshot periods. Retain evidence and owner explanations, record actual formula and recalculation checks, and do not describe unapproved forecasts as confirmed or collected.",
      ],
    },
    scenarios: scenarios(
      [
        "销售运营、商机负责人和业务管理者",
        "Sales operations, opportunity owners, and business leaders",
      ],
      {
        focus: [
          "以稳定编号和统一阶段口径核对商机现状及变化，区分数据事实、预测和负责人判断。",
          "Use stable IDs and consistent stage definitions to review opportunity status and movements, separating facts, forecasts, and owner judgment.",
        ],
        inputs: [
          "记录导出时间、字段含义、金额币种、权限范围与负责人；历史缺失和未经确认的字段单独标示。",
          "Record export time, field meanings, amount currencies, access, and owners; separately flag missing history and unconfirmed fields.",
        ],
        output: [
          "提供可筛选明细、期间汇总、异常队列和处理责任，保留原始数据以供人工核对。",
          "Provide filterable details, period summaries, exception queues, and owners while retaining original data for human review.",
        ],
        risk: [
          "不自动修改CRM、推断客户意向或将预测当成收入；个人和客户信息须按授权限制展示。",
          "Do not change CRM automatically, infer customer intent, or treat forecasts as revenue; restrict personal and client data to authorized viewers.",
        ],
      },
      [
        [
          ["销售漏斗周检", "Weekly pipeline review"],
          [
            "梳理各阶段商机数量及需要推进的事项。",
            "Review opportunity counts and required actions by stage.",
          ],
          [
            "收集本周快照、阶段定义、负责人和下一步。",
            "Gather this week's snapshot, stage definitions, owners, and next steps.",
          ],
          [
            "输出阶段汇总、停滞项和讨论清单。",
            "Produce stage totals, stalled items, and discussion points.",
          ],
          [
            "阶段数量不等于当周真实转化率。",
            "Stage counts alone are not a weekly conversion rate.",
          ],
        ],
        [
          ["预计成交日期复核", "Expected close-date review"],
          [
            "识别已过期或频繁推迟的成交日期。",
            "Identify overdue or repeatedly postponed expected close dates.",
          ],
          [
            "收集历史快照、预计日期、变更原因和负责人。",
            "Gather historical snapshots, expected dates, reasons, and owners.",
          ],
          [
            "列出延期次数、待确认日期和跟进事项。",
            "List postponement counts, dates to confirm, and actions.",
          ],
          [
            "日期过期不能直接判定客户放弃。",
            "An overdue date alone does not prove the customer has withdrawn.",
          ],
        ],
        [
          ["商机阶段变动", "Opportunity stage movement"],
          [
            "对比两次快照识别推进、回退和新增。",
            "Compare two snapshots for advancement, regression, and creation.",
          ],
          ["收集相同范围的两期快照及阶段映射。", "Gather comparable snapshots and stage mappings."],
          [
            "形成阶段变动桥及无法匹配的记录。",
            "Produce a stage-movement bridge and unmatched records.",
          ],
          [
            "快照缺失不能证明期间没有发生变化。",
            "Missing snapshots cannot prove no movement occurred.",
          ],
        ],
        [
          ["重复商机排查", "Duplicate opportunity review"],
          [
            "识别同账户可能重复记录的商机。",
            "Identify possible duplicate opportunities for the same account.",
          ],
          [
            "收集账户编号、项目名称、金额、创建日期及负责人。",
            "Gather account IDs, project names, amounts, creation dates, and owners.",
          ],
          [
            "输出候选重复组、相似依据和人工处理状态。",
            "Produce suspected duplicate groups, matching evidence, and review states.",
          ],
          [
            "不同项目可能金额相同，不自动合并删除。",
            "Distinct projects can have matching values; do not merge or delete automatically.",
          ],
        ],
        [
          ["商机字段完整性", "Opportunity field completeness"],
          ["检查关键阶段必需字段的缺失情况。", "Check missing fields required at key stages."],
          [
            "收集阶段字段规则、商机快照和负责团队。",
            "Gather stage-specific field rules, a snapshot, and responsible teams.",
          ],
          [
            "列出缺失字段、数量、负责人和修复期限。",
            "List missing fields, counts, owners, and remediation deadlines.",
          ],
          [
            "空字段不可用虚构联系人或日期填补。",
            "Do not fill missing fields with invented contacts or dates.",
          ],
        ],
        [
          ["静默商机跟进", "Inactive opportunity follow-up"],
          [
            "找出超过约定周期无活动的商机。",
            "Identify opportunities without activity beyond the agreed interval.",
          ],
          [
            "收集上次活动、阶段、下次动作和例外记录。",
            "Gather last activity, stage, next action, and exceptions.",
          ],
          [
            "提供待确认列表及负责人后续动作。",
            "Provide a review list and owner follow-up actions.",
          ],
          [
            "记录缺失与确实无活动必须区分。",
            "Separate missing activity records from confirmed inactivity.",
          ],
        ],
        [
          ["销售预测变化", "Sales forecast movement"],
          [
            "解释本期与上期预测金额的变化。",
            "Explain changes between current and prior sales forecasts.",
          ],
          [
            "收集两期预测、商机金额、类别和汇率。",
            "Gather both forecasts, opportunity amounts, categories, and exchange rates.",
          ],
          [
            "列示新增、延期、金额变化和退出的差异桥。",
            "Show a variance bridge for additions, delays, amount changes, and exits.",
          ],
          [
            "预测变动不能直接视为确认收入变动。",
            "Forecast movement is not the same as recognized revenue movement.",
          ],
        ],
        [
          ["重点商机会议", "Key-opportunity meeting"],
          [
            "准备重点商机的证据、障碍和决策请求。",
            "Prepare evidence, blockers, and decision requests for key opportunities.",
          ],
          [
            "收集目标账户、阶段、客户反馈及待办。",
            "Gather target accounts, stages, customer feedback, and actions.",
          ],
          [
            "输出会议清单、问题及责任人跟进。",
            "Produce a meeting list, issues, and owner follow-up.",
          ],
          [
            "客户未确认的决策时间应标为假设。",
            "Label unconfirmed customer decision dates as assumptions.",
          ],
        ],
        [
          ["商机来源分析", "Opportunity source analysis"],
          [
            "比较不同来源的商机数量和后续进展。",
            "Compare opportunity counts and subsequent progress by source.",
          ],
          [
            "收集来源标签、创建日期、阶段和归因规则。",
            "Gather source labels, creation dates, stages, and attribution rules.",
          ],
          [
            "显示来源分布、样本量与未知归因。",
            "Show source distribution, sample sizes, and unknown attribution.",
          ],
          [
            "来源缺失或多次触达不应强行归因。",
            "Do not force attribution when source data is missing or multiple touches occurred.",
          ],
        ],
        [
          ["渠道商机交接", "Partner opportunity handoff"],
          [
            "跟踪渠道与直销之间的商机交接。",
            "Track opportunity handoffs between partners and direct sales.",
          ],
          [
            "收集转介授权、账户、交接日期和双方负责人。",
            "Gather referral authority, account, handoff dates, and both owners.",
          ],
          [
            "列出接收状态、冲突和待确认后续步骤。",
            "List acceptance states, conflicts, and next steps to confirm.",
          ],
          [
            "未经授权不得向伙伴共享客户敏感信息。",
            "Do not share sensitive client data with partners without authorization.",
          ],
        ],
        [
          ["合同签署状态", "Contract signature status"],
          [
            "对照商机和合同签署过程中的真实状态。",
            "Compare opportunity records with actual contract-signature progress.",
          ],
          [
            "收集合同编号、审批、签署日期和归档状态。",
            "Gather contract IDs, approvals, signature dates, and archive status.",
          ],
          [
            "列出待审批、待签署、已签署和待核实项。",
            "List pending approval, pending signature, signed, and unverified items.",
          ],
          [
            "口头确认或草稿不得标记为已签署。",
            "Do not mark verbal agreement or draft contracts as signed.",
          ],
        ],
        [
          ["商机关闭原因复盘", "Opportunity closure review"],
          [
            "按实际记录分析赢单和失单的已知原因。",
            "Analyze documented reasons for won and lost opportunities.",
          ],
          [
            "收集关闭日期、原因、客户反馈和样本范围。",
            "Gather close dates, reasons, customer feedback, and sample scope.",
          ],
          [
            "显示原因分布、未知项和改进假设。",
            "Show reason distribution, unknowns, and improvement hypotheses.",
          ],
          [
            "记录缺失不能归类成价格原因或证明因果。",
            "Do not assign missing reasons to price or infer causation.",
          ],
        ],
      ],
      CRM_PIPELINE_REVIEW_DETAILS,
    ),
  },
  {
    id: "brand-content-calendar",
    name: ["品牌内容排期", "Brand content calendar"],
    category: "marketing",
    format: "XLSX",
    summary: [
      "规划选题、素材、审核和多渠道发布时间",
      "Plan topics, assets, approvals, and multichannel publication",
    ],
    style: ["清楚、有节奏、品牌一致", "Clear, paced, and brand-consistent"],
    sections: [
      [
        "objectives",
        "目标与受众",
        "Goals and audience",
        "定义受众、传播目标和观察指标。",
        "Define audience, communication goals, and measures.",
      ],
      [
        "themes",
        "内容主题",
        "Editorial themes",
        "整理主题、信息角度和证据。",
        "Organize themes, angles, and supporting evidence.",
      ],
      [
        "calendar",
        "排期安排",
        "Calendar",
        "安排渠道、时间、责任人和依赖。",
        "Schedule channels, dates, owners, and dependencies.",
      ],
      [
        "production",
        "制作与素材",
        "Production and assets",
        "标注文案、图片、链接及素材授权。",
        "Track copy, images, links, and asset rights.",
      ],
      [
        "approval",
        "审核与发布",
        "Approval and publishing",
        "区分草稿、审核、批准和实际发布。",
        "Separate drafts, review, approval, and actual publication.",
      ],
      [
        "results",
        "结果与调整",
        "Results and adjustments",
        "记录表现、学习及后续修订。",
        "Record results, learning, and revisions.",
      ],
    ],
    acceptance: [
      [
        "每条内容有目标受众、渠道、负责人和状态。",
        "Every item has an audience, channel, owner, and state.",
      ],
      [
        "素材授权、事实依据及审核记录可追溯。",
        "Asset rights, factual support, and approvals are traceable.",
      ],
      [
        "计划发布时间不等于实际发布或取得效果。",
        "A planned time does not imply publication or results.",
      ],
    ],
    workflow: [
      ["确认目标、受众及品牌规范。", "Confirm goals, audience, and brand rules."],
      ["整理选题、证据与素材需求。", "Organize topics, evidence, and asset needs."],
      ["安排制作、审核和发布节点。", "Schedule production, review, and publication."],
      ["核对实际发布与可比指标。", "Check actual publication and comparable metrics."],
    ],
    playbook: {
      inputs: [
        "收集传播目标、目标受众、品牌语气、渠道规则、活动节点、已确认产品信息、内容选题、素材授权、审核人和可用资源；记录每个渠道的时区、发布时间及数据口径。未授权的图片、客户案例和未经核实的事实不得直接用于发布。",
        "Collect communications goals, audience, brand voice, channel rules, campaign dates, confirmed product information, topics, asset rights, reviewers, and capacity. Record channel time zones, publication times, and metric definitions; do not publish unauthorized images or cases or unverified claims.",
      ],
      method: [
        "根据受众问题设计内容支柱和具体选题，分别确定内容目的、核心信息、证据、渠道适配及预期动作；倒排资料准备、制作、事实审核、法务或品牌审批和发布。遇到事件变化或审核延迟时保留版本并通知责任人，不自动发布或代替审批。",
        "Develop content pillars and specific topics from audience needs, defining purpose, key message, evidence, channel adaptation, and desired action. Schedule research, creation, fact checks, legal or brand approval, and publication backward; retain versions and notify owners about changes without automatically publishing or approving.",
      ],
      design: [
        "工作簿分为策略概览、内容日历、素材和授权、审核队列、发布记录及效果复盘；每条内容有稳定编号，日期为真实时间类型，状态用文字和颜色共同表达。渠道、负责人、主题和审核状态支持筛选，避免将长正文塞进日历单元格。",
        "Separate strategy, editorial calendar, assets and rights, review queue, publication log, and results. Give each item a stable ID, use typed dates and text-plus-color statuses, enable filters for channel, owner, theme, and review, and keep long copy outside calendar cells.",
      ],
      checks: [
        "核对每条内容的事实来源、素材许可、链接、审核责任和实际发布记录，检查同一时段冲突以及计划与现实差异；指标注明平台、观察窗口和分母。复核表格公式和渲染，任何未执行的审核、发布或效果验证都必须标明未完成。",
        "Verify each item's sources, asset rights, links, review ownership, and actual publication; check schedule conflicts and plan-versus-actual differences. Label metrics by platform, window, and denominator; report actual formula and rendering checks, never claiming unperformed review, publication, or results.",
      ],
    },
    scenarios: scenarios(
      ["品牌编辑、内容运营和审核负责人", "Brand editors, content operators, and reviewers"],
      {
        focus: [
          "围绕受众需求和明确传播目标安排选题、内容制作、审核及渠道节奏，区分计划和真实状态。",
          "Plan topics, production, review, and channel cadence around audience needs and clear goals, distinguishing plans from actual status.",
        ],
        inputs: [
          "核对品牌规范、渠道规则、资料来源、素材许可、时区和审批负责人，缺少授权的内容列为待处理。",
          "Check brand and channel rules, sources, asset rights, time zones, and approvers; flag content missing permission.",
        ],
        output: [
          "交付可筛选的内容日历、素材及审批状态、负责人和后续检查时间，保留可修改的版本记录。",
          "Deliver a filterable calendar, asset and approval states, owners, review dates, and editable version records.",
        ],
        risk: [
          "不自动对外发布，不虚构数据或客户背书；敏感议题和商业承诺须经适当审核。",
          "Do not publish automatically or invent data or endorsements; sensitive topics and commercial claims need appropriate review.",
        ],
      },
      [
        [
          ["月度内容日历", "Monthly editorial calendar"],
          [
            "按周平衡主题、渠道和团队工作量。",
            "Balance themes, channels, and team workload by week.",
          ],
          [
            "收集月度目标、内容支柱、可用人力和关键日期。",
            "Gather monthly goals, content pillars, capacity, and key dates.",
          ],
          [
            "列出选题、制作节点与预计发布时间。",
            "List topics, production milestones, and planned publication times.",
          ],
          [
            "未通过审核的内容不可视为已发布。",
            "Unapproved content must not be treated as published.",
          ],
        ],
        [
          ["新品预热内容", "Product launch teaser content"],
          [
            "安排新品发布前的内容递进和信息边界。",
            "Sequence prelaunch content and disclosure boundaries.",
          ],
          [
            "收集发布计划、保密时间及可公开卖点。",
            "Gather the launch plan, embargo, and approved public messages.",
          ],
          ["形成预热选题、素材和审核日程。", "Produce teaser topics, assets, and review dates."],
          [
            "保密期内不得提前披露产品信息。",
            "Do not disclose product information before the embargo ends.",
          ],
        ],
        [
          ["节日品牌内容", "Seasonal brand content"],
          ["结合节日情境安排适合受众的内容。", "Plan audience-appropriate seasonal content."],
          [
            "收集节日日期、受众地区、品牌定位和素材。",
            "Gather dates, audience regions, brand positioning, and assets.",
          ],
          [
            "输出选题、渠道适配及审核节点。",
            "Produce topics, channel adaptations, and review gates.",
          ],
          [
            "尊重文化差异，不虚构节日习俗。",
            "Respect cultural differences and do not invent customs.",
          ],
        ],
        [
          ["客户故事排期", "Customer story calendar"],
          [
            "安排客户案例采访、审核和公开时间。",
            "Schedule customer interviews, approvals, and publication.",
          ],
          [
            "收集客户同意范围、采访计划和证据素材。",
            "Gather customer consent, interview plans, and supporting material.",
          ],
          [
            "列出案例状态、授权记录和发布依赖。",
            "List case states, permissions, and publication dependencies.",
          ],
          [
            "客户未书面授权前不得公开名称或数据。",
            "Do not disclose customer names or data without written authorization.",
          ],
        ],
        [
          ["多渠道内容改编", "Multichannel content adaptation"],
          [
            "将同一核心信息适配不同渠道和受众。",
            "Adapt a core message for different channels and audiences.",
          ],
          [
            "收集原始内容、渠道尺寸、字数和链接规则。",
            "Gather source content and channel dimensions, length, and link rules.",
          ],
          [
            "形成渠道版本、制作责任和审核状态。",
            "Produce channel versions, production owners, and approval states.",
          ],
          [
            "改编不得改变原始证据含义或省略限制。",
            "Do not change the meaning of evidence or omit limitations during adaptation.",
          ],
        ],
        [
          ["内容素材授权", "Content asset rights"],
          [
            "核对图片、音乐和引用素材的使用权限。",
            "Verify rights for images, audio, and quoted material.",
          ],
          [
            "收集素材来源、许可条款、期限和使用渠道。",
            "Gather sources, license terms, expiry dates, and channels.",
          ],
          [
            "列出可用范围、署名要求和待确认项。",
            "List permitted uses, attribution requirements, and open items.",
          ],
          [
            "来源不明素材不得假定可商用。",
            "Do not assume material of unknown origin is commercially usable.",
          ],
        ],
        [
          ["内容审核队列", "Editorial approval queue"],
          ["追踪文案、事实和品牌审核的顺序。", "Track copy, fact, and brand review in sequence."],
          [
            "收集内容版本、审核角色、截止日和反馈。",
            "Gather content versions, review roles, deadlines, and feedback.",
          ],
          [
            "提供待审列表、退回原因及复审责任。",
            "Provide a review queue, return reasons, and re-review owners.",
          ],
          ["未回应不能自动视为批准。", "Silence must not be interpreted as approval."],
        ],
        [
          ["活动传播排期", "Event promotion schedule"],
          [
            "协调活动报名期、提醒和活动后内容。",
            "Coordinate registration-period, reminder, and post-event content.",
          ],
          [
            "收集活动时间、报名链接、受众与讲者授权。",
            "Gather event times, registration links, audience, and speaker permissions.",
          ],
          [
            "给出宣传节奏、链接及发布责任人。",
            "Provide the promotion cadence, links, and publishing owners.",
          ],
          [
            "活动时间或链接变更后须同步所有版本。",
            "Update all versions when event times or links change.",
          ],
        ],
        [
          ["员工倡导内容", "Employee advocacy content"],
          [
            "准备员工可自愿分享的品牌内容。",
            "Prepare brand content employees may choose to share.",
          ],
          [
            "收集可公开信息、社交渠道和内部审核意见。",
            "Gather public information, social channels, and internal approvals.",
          ],
          [
            "输出可选文案、素材和适用边界。",
            "Provide optional copy, assets, and usage boundaries.",
          ],
          [
            "不得把员工转发设成未经确认的强制要求。",
            "Do not make employee sharing mandatory without an explicit policy.",
          ],
        ],
        [
          ["内容表现复盘", "Content performance review"],
          [
            "比较内容目标与不同渠道的实际表现。",
            "Compare content goals with actual results across channels.",
          ],
          [
            "收集平台数据、观察窗口、投入和目标值。",
            "Gather platform metrics, observation windows, effort, and targets.",
          ],
          [
            "呈现可比指标、局限和下一轮假设。",
            "Show comparable metrics, limitations, and next-cycle hypotheses.",
          ],
          [
            "曝光不等于转化，不同平台口径不可直接混算。",
            "Impressions are not conversions; do not mix incompatible platform metrics.",
          ],
        ],
        [
          ["历史内容更新", "Evergreen content refresh"],
          [
            "筛选需要更新的过期资料和失效链接。",
            "Identify outdated content and broken links for refresh.",
          ],
          [
            "收集现有内容、最后更新日、数据来源和负责人。",
            "Gather existing content, last-update dates, sources, and owners.",
          ],
          [
            "输出修改清单、证据及重新审核时间。",
            "Produce a change list, evidence, and re-review dates.",
          ],
          [
            "不要静默修改历史引用或删除必要免责声明。",
            "Do not silently alter historical quotations or remove required disclaimers.",
          ],
        ],
        [
          ["敏感事件暂停发布", "Pause publishing during sensitive events"],
          [
            "复核已排期内容是否需要暂停或调整。",
            "Review whether scheduled content should be paused or changed.",
          ],
          [
            "收集事件事实、已排期内容、渠道与审批人。",
            "Gather incident facts, scheduled content, channels, and approvers.",
          ],
          [
            "列出建议暂停项、确认责任及后续复查。",
            "List proposed pauses, confirmation owners, and follow-up review.",
          ],
          [
            "不得自动操作平台或对未证实事件下结论。",
            "Do not operate platforms automatically or conclude unverified events.",
          ],
        ],
      ],
      BRAND_CONTENT_CALENDAR_DETAILS,
    ),
  },
  {
    id: "campaign-experiment",
    name: ["营销实验", "Marketing experimentation"],
    category: "marketing",
    format: "XLSX",
    summary: [
      "从假设、分组、指标到复盘记录营销实验",
      "Record marketing experiments from hypothesis and allocation through metrics and review",
    ],
    style: ["实验驱动、谨慎解释、数据清晰", "Experiment-led, cautious, and data-clear"],
    sections: [
      [
        "question",
        "问题与假设",
        "Question and hypothesis",
        "明确决策问题、假设和预期机制。",
        "Define the decision, hypothesis, and expected mechanism.",
      ],
      [
        "design",
        "实验设计",
        "Experiment design",
        "记录人群、分组、变量和观察窗口。",
        "Record population, allocation, variables, and observation window.",
      ],
      [
        "metrics",
        "指标与保护",
        "Metrics and guardrails",
        "定义主要指标、分母和风险阈值。",
        "Define primary metrics, denominators, and guardrails.",
      ],
      [
        "execution",
        "执行记录",
        "Execution log",
        "保留版本、上线和中断事件。",
        "Retain versions, launches, and interruptions.",
      ],
      [
        "analysis",
        "结果分析",
        "Results analysis",
        "对比结果并说明偏差与不确定性。",
        "Compare results and explain bias and uncertainty.",
      ],
      [
        "decision",
        "决策与后续",
        "Decision and follow-up",
        "记录负责人、结论与后续验证。",
        "Record owner, decision, and follow-up validation.",
      ],
    ],
    acceptance: [
      [
        "假设、变量、分组和指标定义在结果前明确。",
        "Hypothesis, variables, allocation, and metrics are defined before results.",
      ],
      [
        "样本、观察窗口和未验证限制与结果一起呈现。",
        "Present sample, observation window, and unverified limitations with results.",
      ],
      [
        "相关性、统计结果和商业决策分开记录。",
        "Separate correlation, statistical results, and business decisions.",
      ],
    ],
    workflow: [
      ["定义决策问题与可检验假设。", "Define a decision and testable hypothesis."],
      [
        "确认分组、口径、预算和保护条件。",
        "Confirm allocation, definitions, budget, and guardrails.",
      ],
      ["记录实际执行及数据异常。", "Record actual execution and data anomalies."],
      ["解释结果、限制和下一轮选择。", "Interpret results, limitations, and next steps."],
    ],
    playbook: {
      inputs: [
        "收集实验问题、目标受众与资格条件、历史基线、分组方式、版本差异、实验周期、预算、渠道、指标定义和隐私授权；记录数据采集时间、归因窗口与已有活动重叠。没有实际实验数据时只建立计划，不能制造样本或结果。",
        "Gather the experiment question, eligible audience, baseline, allocation, variants, duration, budget, channel, metric definitions, and privacy permissions. Record collection time, attribution windows, and overlapping campaigns; create a plan only when actual experiment data is absent.",
      ],
      method: [
        "先确认可检验假设、唯一主要变化和主要指标，再定义分组、观察窗口、样本限制、排除规则和业务保护阈值；记录实际投放偏差与数据缺口。结果按原始人数及分母计算，并说明随机化、统计方法或样本不足对结论的限制。",
        "Define a testable hypothesis, primary change, and primary metric before specifying allocation, window, sample limits, exclusions, and business guardrails. Record execution deviations and missing data; calculate with actual counts and denominators, explaining randomization, statistical-method, and sample-size limitations.",
      ],
      design: [
        "分设实验登记、受众与版本、预算、日度数据、指标计算、异常日志和决策复盘工作表；输入值与公式分离，比例、成本及日期使用正确格式。当前工具实际支持时才制作图表，否则提供可绘图数据表及建议；标注样本量、时间范围、基线和阈值，不用颜色暗示统计显著。",
        "Create experiment registry, audience and variants, budget, daily data, metric calculations, anomaly log, and decision sheets. Separate inputs and formulas and format rates, costs, and dates correctly. Create charts only when the available tool supports them; otherwise provide chart-ready data and recommendations. Label samples, time ranges, baselines, and thresholds without implying significance by color.",
      ],
      checks: [
        "核对分组人数、曝光和转化分母、重复用户、预算及时间窗口，检查实验中途改版或渠道变化；结果无法解释时保留不确定。独立复核公式并如实记录重算状态，涉及个人数据和对外宣传先经授权，不把相关性或模拟数据当因果证据。",
        "Reconcile allocation, exposure and conversion denominators, duplicate users, spend, and windows; inspect mid-test variant or channel changes and retain uncertainty. Independently check formulas, disclose recalculation status, obtain privacy and external-claims approval, and never present correlations or synthetic data as causal evidence.",
      ],
    },
    scenarios: scenarios(
      ["营销运营、数据分析师和实验负责人", "Marketing operators, analysts, and experiment owners"],
      {
        focus: [
          "先定义明确的实验假设、比较条件及成功和停止标准，再以真实执行记录解释结果与局限。",
          "Define the testable hypothesis, comparison, success, and stop conditions first, then interpret results and limits from actual execution.",
        ],
        inputs: [
          "核对受众资格、数据来源、分组方式、时间窗口、指标分母、预算和隐私授权，缺失项明确登记。",
          "Check eligibility, data sources, allocation, time windows, metric denominators, budget, and privacy permissions; record missing items.",
        ],
        output: [
          "提供实验登记、逐期数据、指标公式、异常记录及由负责人确认的决策和后续验证事项。",
          "Provide an experiment record, periodic data, metric formulas, anomalies, owner-confirmed decision, and follow-up validation.",
        ],
        risk: [
          "没有合格对照或足够数据时不宣称因果或显著效果；不得自动投放、更改预算或处理个人信息。",
          "Do not claim causation or significance without a suitable comparison and sufficient data; do not automatically launch, change budgets, or process personal data.",
        ],
      },
      [
        [
          ["落地页标题实验", "Landing-page headline test"],
          [
            "把标题作为唯一变项，同一访客固定看到同一版本；以首次合格访问起算观察窗口。",
            "Change only the headline, keep each visitor on an assigned variant, and start the observation window at the first eligible visit.",
          ],
          [
            "收集标题原文、改版截图、流量入口、分流日志和转化事件定义，标记埋点中断日期。",
            "Gather exact headlines, change screenshots, traffic sources, allocation logs, and conversion definitions; flag tracking outages.",
          ],
          [
            "用版本对照表展示合格访客数、转化人数、转化率和绝对百分点差，另列需复验的入口。",
            "Show eligible visitors, converted visitors, conversion rates, and percentage-point differences by variant; identify traffic sources that need a retest.",
          ],
          [
            "加载速度、首屏图片或表单同时改动时不能把差异只归给标题；回访跨版本情况单列。",
            "Do not attribute differences to the headline alone if speed, hero imagery, or forms changed; list repeat visits that crossed variants.",
          ],
        ],
        [
          ["邮件主题实验", "Email subject-line test"],
          [
            "固定发件人、正文和发送批次，仅比较主题行；先定点击或后续目标行为为主要指标，再看打开。",
            "Hold sender, body, and send batch constant while testing the subject; prioritize clicks or a downstream action before reading opens.",
          ],
          [
            "收集获许可的分组汇总、预览文本、送达与退信明细口径、独立点击、投诉及退订计数。",
            "Gather consented allocation totals, preview text, delivery and bounce definitions, unique clicks, complaints, and unsubscribe counts.",
          ],
          [
            "给出每批次送达率及按送达计算的独立点击率，附投诉和退订阈值与下一批是否暂缓。",
            "Show delivery and unique clicks per delivery by batch, with complaint and unsubscribe limits and whether to hold the next batch.",
          ],
          [
            "区分机器扫描的链接点击、隐私代理预加载与真人行为；重发及相同收件人的多次点击不得重复计入。",
            "Separate automated link scans and privacy prefetch from human activity; do not double-count resends or repeated clicks by one recipient.",
          ],
        ],
        [
          ["素材创意比较", "Creative asset comparison"],
          [
            "先只替换图片或文案之一，在版位与受众范围相近时比较；记录无法锁定的出价和优化策略。",
            "Vary either image or copy first, compare similar placements and audiences, and record bidding or optimization settings that could not be held fixed.",
          ],
          [
            "收集素材稿号、尺寸、文案、授权、版位及每日展量、触达人次、点击、目标事件和实际消耗。",
            "Gather creative IDs, dimensions, copy, rights, placements, and daily impressions, reach, clicks, target events, and actual spend.",
          ],
          [
            "逐版位展示曝光、点击、每次有效行动成本和素材更新时间；用条件差异单解释聚合排名为何变化。",
            "Show exposures, clicks, cost per qualifying action, and creative update dates by placement; explain ranking shifts in a delivery-conditions log.",
          ],
          [
            "自动优化、素材疲劳与频控会改变展示对象；不能凭较高点击率判定后链路更好，也不复用无授权素材。",
            "Optimization, fatigue, and frequency controls change who sees an asset; high click rates do not establish better downstream outcomes, and unlicensed assets must not be reused.",
          ],
        ],
        [
          ["受众细分试验", "Audience segment experiment"],
          [
            "先按可解释的业务属性定义可用分群，在群内比较同一处理的增量，分开呈现群间既有基线差。",
            "Define permitted segments using explainable business attributes, compare incremental outcomes within segments, and report baseline differences between them separately.",
          ],
          [
            "收集分群版本、是否互斥、入群日期、授权范围、各群基线及曝光分母，仅使用经许可的汇总数据。",
            "Gather segment versions, exclusivity, enrollment dates, consent scope, baselines, and exposure denominators using permitted aggregate data only.",
          ],
          [
            "输出分群字典、重叠计数及每群分配和响应表，提出哪些群可复验、哪些因样本不足只作观察。",
            "Provide a segment dictionary, overlap counts, allocation and response tables, and which groups merit retesting versus observation only.",
          ],
          [
            "小群体也可能被反识别；不推断敏感属性，不对未经审批的分群投放；检验多个群时说明偶然发现风险。",
            "Small groups can still be reidentified. Do not infer sensitive attributes or target unapproved segments; explain chance discoveries when evaluating many segments.",
          ],
        ],
        [
          ["投放渠道试验", "Channel pilot"],
          [
            "给两个渠道设同一合格线索定义和观察截止点，再按受众资格、地区和可归因流量比较线索质量。",
            "Set one qualified-lead definition and observation cutoff for both channels, then compare lead quality within comparable eligibility, regions, and attributable traffic.",
          ],
          [
            "收集媒介费、活动制作费、渠道编码、认领去重规则、CRM后续状态及返点是否已计入。",
            "Gather media and production costs, channel codes, claim-deduplication rules, CRM follow-up states, and whether rebates are included.",
          ],
          [
            "将单渠道表与跨渠道去重表分开，计算每条合格线索成本及后续有效率，标记口径不可比的区段。",
            "Separate channel-level and cross-channel deduplicated views; compute cost per qualifying lead and downstream validity, marking incomparable slices.",
          ],
          [
            "交叉触达、自然转化和延迟录入可能把一笔成果算给两个渠道；没有可比组时只出观察结果。",
            "Overlapping reach, organic conversions, and delayed recording can credit one outcome twice; report observational results only without comparable groups.",
          ],
        ],
        [
          ["活动报名流程试验", "Event registration-flow test"],
          [
            "定义从开始填表到收到有效确认的端到端流程，只改变指定字段或步骤并按设备区分卡点。",
            "Define the journey from form start to valid confirmation, vary only the selected field or step, and distinguish friction by device.",
          ],
          [
            "收集流程截图、字段清单、开始和确认事件、错误码、活动满额时点及经同意的匿名会话标识。",
            "Gather flow screenshots, field inventories, start and confirmation events, error codes, capacity cutoff, and consented anonymous session identifiers.",
          ],
          [
            "输出按版本的入口、提交及确认漏斗，分列校验错误、人工取消、满额以及各步耗时分布。",
            "Show entry, submission, and confirmation funnels by variant, separating validation failures, staff cancellations, capacity, and step-time distributions.",
          ],
          [
            "报名重试与跨设备会话只有在可靠键下去重；若删掉资格字段，不能只看完成率而忽略后续审核压力。",
            "Deduplicate retries or cross-device sessions only with reliable keys; if an eligibility field is removed, review downstream screening load as well as completion.",
          ],
        ],
        [
          ["内容发布时间试验", "Publication timing test"],
          [
            "在相同题材、平台和推广条件内轮换发布时间，用同长度的发布后观察窗口比较，而非同一个截止时刻。",
            "Rotate publication times within comparable topics, platforms, and promotion conditions, measuring equal post-publication windows rather than a common deadline.",
          ],
          [
            "收集内容编号、原始时间戳、独立时区字段、节假日、跨区受众比例及每期有机与付费曝光。",
            "Gather content IDs, source timestamps, separate timezone fields, holidays, cross-region audience shares, and organic and paid impressions for each period.",
          ],
          [
            "输出星期与时段交叉表，用曝光分母展示互动率，并给下一轮排期和内容配对的尝试建议。",
            "Show a weekday-by-slot table with engagements per impression and suggest timing and content pairings to try in the next round.",
          ],
          [
            "夏令时转换、临时首页推荐及热点事件要单独标记；不能把单篇爆款当作时段在所有受众上的优势。",
            "Flag daylight-saving changes, temporary featured placement, and trending events; one breakout post does not establish a universal time-slot advantage.",
          ],
        ],
        [
          ["召回信息试验", "Re-engagement message test"],
          [
            "先按最后真实活动定义沉默人群，以不联系组估计自然回流；在许可渠道内一次只改变一个消息要素。",
            "Define inactivity from the last real activity and use a no-contact group to estimate organic return; vary one message element within permitted channels.",
          ],
          [
            "收集聚合的许可状态、排除规则、频控上限、各群距上次活动时长、送达及可验证的回流事件。",
            "Gather aggregate consent state, exclusions, frequency caps, time since activity by cohort, deliveries, and verifiable return events.",
          ],
          [
            "对照自然回流和触达组复活率，附退订、投诉、联系频次及暂停触达建议，默认不保留人名。",
            "Compare return rates against organic return, with unsubscribes, complaints, contact frequency, and hold recommendations; omit names by default.",
          ],
          [
            "撤回同意或进入免扰状态须立即排除；仅打开消息不算重新活跃，不得用便捷的打开口径掩盖退出成本。",
            "Exclude withdrawn consent and do-not-contact immediately. Opening a message alone is not reactivation and must not hide opt-out costs.",
          ],
        ],
        [
          ["预算分配试点", "Budget allocation pilot"],
          [
            "以批准的总额和资源下限为约束，比较不同配置的边际成本；分出固定渠道成本、活动增量和测量支出。",
            "Compare marginal cost under the approved total and resource floors; separate fixed channel costs, incremental activity, and measurement spend.",
          ],
          [
            "收集批准版本、付款与应计口径、货币、投放日程、有效结果及触达上限，确认优惠和税费归属。",
            "Gather approved versions, cash and accrual definitions, currency, flight dates, qualifying outcomes, and reach caps; confirm treatment of discounts and taxes.",
          ],
          [
            "对照表展示原计划、实际及候选分配，计算每单位增量成果成本，并注明剩余额度和无法重分配的承诺。",
            "Compare plan, actuals, and candidate allocations; compute cost per incremental result and show remaining headroom and nonreallocatable commitments.",
          ],
          [
            "预算规模改变可能导致竞价或受众饱和；保守列示情景，不线性外推小样本，不自动调整余额或追加投放。",
            "Budget scale can change auction dynamics or saturate audiences. Use conservative scenarios, avoid linear extrapolation from small samples, and do not reallocate or spend automatically.",
          ],
        ],
        [
          ["转化路径分析", "Conversion-path analysis"],
          [
            "从同一进站队列重建按时间有序的真实路径，提前定义允许跳步和回访的规则，再定位分母最大的流失。",
            "Reconstruct ordered journeys for the same entry cohort, define allowed skips and returns first, and locate drop-offs with meaningful denominators.",
          ],
          [
            "收集埋点版本、事件顺序、匿名键、设备和入口分组、时钟偏差及跨日会话规则，不直接拼接个人明细。",
            "Gather instrumentation versions, event order, anonymous keys, device and entry groups, clock skew, and cross-day session rules without stitching personal details.",
          ],
          [
            "输出转移表、各步人数与净流失、回流和未观察完成，从中提取可通过后续访谈或实验验证的两类假设。",
            "Show transition counts, net loss, returns, and unobserved completions; extract two kinds of hypotheses for interviews or follow-up experiments.",
          ],
          [
            "埋点丢失和用户稍后完成都可表现为流失；检查重复回调和数据时滞，不能仅凭路径相关性更改业务规则。",
            "Missing tracking and delayed completion can look like drop-off; check duplicate callbacks and delays rather than changing business rules based on association alone.",
          ],
        ],
        [
          ["实验提前停止复核", "Early-stop review"],
          [
            "在实际停止时点冻结数据，区分预设保护线触发、运营中断和看到结果后临时决定这三种情况。",
            "Freeze data as of the stop time and distinguish a preset guardrail trigger, an operational interruption, and an ad hoc decision after viewing results.",
          ],
          [
            "收集初始方案、原计划停止日、触发记录、在途样本、延迟转化及授权决定，记录谁在何时看过指标。",
            "Gather the original plan, scheduled end, trigger history, in-flight samples, delayed outcomes, and authorization; record who saw which metrics and when.",
          ],
          [
            "给出原计划与实际停止差异、中断前样本与成熟结果、需作废指标及恢复或重开的审批条件。",
            "Show planned versus actual stopping, pre-stop samples and mature outcomes, metrics to invalidate, and approvals for resuming or restarting.",
          ],
          [
            "频繁查看指标会增加误判风险；除非原方案允许序贯方法且有可靠校验，不能套用完整周期的显著性结论。",
            "Repeated peeking raises error risk. Do not use full-duration significance claims unless the plan allowed a reliably validated sequential method.",
          ],
        ],
        [
          ["实验组合复盘", "Experiment portfolio review"],
          [
            "先按决策主题和证据强度归类实验，标记未完成及阴性结果，辨别重复假设、相反发现与确可迁移的方法。",
            "Group experiments by decision topic and strength of evidence; include unfinished and negative tests and identify duplicate hypotheses, conflicts, and transferable methods.",
          ],
          [
            "收集实验编号、历史版本、放弃原因、实际样本、渠道与季节、指标定义版本和最终决策人。",
            "Gather experiment IDs, historical versions, abandonment reasons, actual samples, channels and seasons, metric-definition versions, and decision owners.",
          ],
          [
            "交付证据矩阵和未决问题队列，列出下轮实验的决策价值、最低资料、依赖及值得复核的旧结论。",
            "Deliver an evidence matrix and open-question queue: decision value, minimum inputs, dependencies, and older conclusions to revisit for the next round.",
          ],
          [
            "不能因报告库缺少失败记录就计算整体成功率；不同归因窗口、重叠样本及主要指标保持不可合并状态。",
            "Do not compute an overall success rate from a registry missing failures; keep different attribution windows, overlapping samples, and unlike primary metrics unpooled.",
          ],
        ],
      ],
    ),
  },
  {
    id: "event-delivery",
    name: ["会务执行", "Event delivery"],
    category: "operations",
    format: "XLSX",
    summary: [
      "统筹会议活动的时间、人员、供应商与现场保障",
      "Coordinate event timing, people, suppliers, and on-site readiness",
    ],
    style: ["清晰、可执行、便于现场查看", "Clear, actionable, and usable on site"],
    sections: [
      [
        "brief",
        "活动目标",
        "Event brief",
        "明确受众、规模、目标和边界。",
        "Define audience, scale, goals, and boundaries.",
      ],
      [
        "schedule",
        "时间与流程",
        "Schedule and run of show",
        "安排准备节点、流程和交接。",
        "Schedule preparation, the run of show, and handoffs.",
      ],
      [
        "people",
        "人员与职责",
        "People and ownership",
        "记录负责人、讲者、来宾和联络方式。",
        "Record owners, speakers, guests, and contact channels.",
      ],
      [
        "suppliers",
        "场地与供应商",
        "Venue and suppliers",
        "跟踪场地、设备、合同和交付。",
        "Track venue, equipment, contracts, and delivery.",
      ],
      [
        "risk",
        "风险与预案",
        "Risks and contingencies",
        "安排替代方案、触发条件及升级。",
        "Plan alternatives, triggers, and escalation.",
      ],
      [
        "close",
        "结束与复盘",
        "Closeout and review",
        "记录结算、资料归档和后续行动。",
        "Record settlement, records, and follow-up actions.",
      ],
    ],
    acceptance: [
      [
        "每个关键节点有时间、责任人和完成标准。",
        "Each critical milestone has a time, owner, and completion criterion.",
      ],
      [
        "场地、讲者、供应商和应急方案的确认状态可追溯。",
        "Venue, speaker, supplier, and contingency confirmations are traceable.",
      ],
      [
        "预算、出席及实际执行不由计划值冒充。",
        "Plans do not stand in for actual spend, attendance, or execution.",
      ],
    ],
    workflow: [
      ["确认活动目标、范围及约束。", "Confirm goals, scope, and constraints."],
      ["倒排流程并分配责任。", "Plan backward and assign ownership."],
      ["核对供应商、现场及应急准备。", "Check suppliers, venue, and contingencies."],
      ["记录实际结果、结算和复盘。", "Record actual results, settlement, and lessons."],
    ],
    playbook: {
      inputs: [
        "收集活动目标、受众与人数范围、时间地点、预算审批、议程、讲者及来宾授权、场地限制、设备需求、供应商报价和安全要求；注明时区、联系人与每项确认日期。涉及嘉宾个人资料、现场影像或录音时先确认授权范围及保管人。",
        "Gather event goals, audience and expected attendance, time and venue, approved budget, agenda, speaker and guest permissions, venue constraints, equipment, supplier quotes, and safety needs. Record time zones, contacts, and confirmation dates; verify consent and custody for personal data, images, or recordings.",
      ],
      method: [
        "以活动开始时间倒排筹备、彩排、接待、现场执行及收尾，明确关键依赖、备用负责人和各类变更的升级路径；安排场地、技术、讲者、报名和物资的逐项确认。对延期、设备故障及人员缺席设触发条件与替代方案，不自行变更合同或发送通知。",
        "Plan backward from the event start through preparation, rehearsal, reception, live delivery, and closeout, identifying dependencies, backups, and escalation for changes. Confirm venue, technology, speakers, registration, and materials; define triggers and alternatives for delay, equipment failure, or absence without changing contracts or sending notices automatically.",
      ],
      design: [
        "工作簿分为活动概览、倒排计划、现场流程、人员联络、供应商、预算、风险及复盘；每项有唯一编号、责任人、时间、状态和证据。冻结表头并筛选关键任务，现场流程使用清楚的本地时间和交接提示，联系方式按需要控制访问。",
        "Separate event overview, preparation, run of show, contacts, suppliers, budget, risks, and review. Give each item an ID, owner, time, status, and evidence; freeze headers and filter critical tasks, use clear local times and handoffs on site, and restrict contact details.",
      ],
      checks: [
        "核对日期时区、场地容量、议程衔接、设备测试、讲者授权、供应商交付及紧急联系人；逐项区分已确认与待确认，并检查预算估计和实际付款。检查表格公式和打印可读性，未演练预案、未到场人数或未付款不得写成完成。",
        "Verify time zones, venue capacity, agenda transitions, equipment tests, speaker permissions, supplier deliveries, and emergency contacts. Separate confirmed from pending items and estimates from actual payments; check formulas and print readability without claiming untested contingencies, attendance, or payment are complete.",
      ],
    },
    scenarios: scenarios(
      [
        "活动负责人、会务团队和供应商联系人",
        "Event leads, event operations, and supplier contacts",
      ],
      {
        focus: [
          "按活动目标和实际时间线组织筹备、现场交接及收尾，明确关键依赖、负责人和完成证据。",
          "Organize preparation, live handoffs, and closeout around the goal and actual timeline, with dependencies, owners, and completion evidence.",
        ],
        inputs: [
          "核对活动时间、参与人数、预算、地点、资料授权、供应商及确认状态，缺失事项明确登记。",
          "Check event timing, attendance, budget, venue, permissions, suppliers, and confirmation states; explicitly log gaps.",
        ],
        output: [
          "交付可筛选的执行清单、现场流程、责任分工、风险预案和待确认节点，支持打印及现场更新。",
          "Deliver a filterable execution checklist, run of show, ownership, contingencies, and pending confirmations for print and live updates.",
        ],
        risk: [
          "计划不等于实际发生；不得自动下单、付款或通知参会者，个人信息和影像仅限授权使用。",
          "Plans are not actual execution; do not order, pay, or notify participants automatically, and use personal data and imagery only with permission.",
        ],
      },
      [
        [
          ["内部会议筹备", "Internal meeting preparation"],
          [
            "先判断各议题用异步阅读还是现场拍板；为现场议题给出时长、主讲、需出席的决策角色及预读期限。",
            "Decide which topics need asynchronous reading or a live decision; assign duration, presenter, necessary decision roles, and pre-read deadlines.",
          ],
          [
            "收集上次行动项、议题提出方、决策选项、资料页面、共享范围和主持人的时间，列出仍缺的预读材料。",
            "Gather prior actions, topic sponsors, decision options, source pages, distribution scope, and facilitator availability; list missing pre-reads.",
          ],
          [
            "交付议程表、会前确认清单、替补主持和会议纪要回收节点；每个议题标明结束时应有的决定或待办。",
            "Deliver an agenda, readiness checklist, backup facilitator, and minutes handoff; show the expected decision or action at the end of each topic.",
          ],
          [
            "未确认出席不等于拒绝；缺少拍板人或材料时建议移至待定议题，不自动变更日程或邀请。",
            "Unconfirmed attendance is not a decline. If a decision maker or evidence is missing, suggest deferring the topic without changing calendars or invites automatically.",
          ],
        ],
        [
          ["客户活动执行", "Customer event delivery"],
          [
            "按抵达、签到、引导、会议及离场走一遍客户路线，标出接待岗与业务岗换手点及迟到时的简化路线。",
            "Walk the guest journey from arrival through check-in, welcome, meeting, and departure; mark handoffs and a simplified route for late arrivals.",
          ],
          [
            "收集授权到访角色和人数、接送及无障碍需求、签到范围、礼宾标准、访客路线和园区进出限制。",
            "Gather authorized visitor roles and counts, transport and accessibility needs, check-in scope, reception standards, routes, and access restrictions.",
          ],
          [
            "提供按位置和时段筛选的接待岗表、临时变更联络树、会后回执清单及仅限现场组查看的来宾资料。",
            "Provide reception posts filterable by location and time, a change contact tree, a follow-up receipt checklist, and visitor information restricted to the event team.",
          ],
          [
            "标牌、摄影和名单分享分别确认同意；访客证件原件或私人号码不进入公开版，特殊礼遇不作未经批准的承诺。",
            "Verify consent separately for signage, photos, and guest lists; exclude ID documents and private numbers from shareable copies and do not promise unapproved special treatment.",
          ],
        ],
        [
          ["线上直播会议", "Online live event"],
          [
            "从候场、主持切换到提问和结束逐步彩排，安排导演信号、后备主持、备用讲稿和停播时的参加指引。",
            "Rehearse waiting room, presenter transitions, questions, and close; assign director cues, a backup host and script, and audience instructions if the stream stops.",
          ],
          [
            "核对平台许可人数、主持和观看权限、连麦方式、字幕与录制设置，注明彩排设备及网络测试时点。",
            "Confirm platform capacity, host and viewer permissions, speaker access, captions, and recording settings, with the rehearsal equipment and network test time.",
          ],
          [
            "交付连线检查矩阵、逐段执行页、讲者失联与屏幕共享失败的切换动作、回放审批及状态发布草稿。",
            "Deliver connection checks, a segment-by-segment run sheet, cutover actions for unavailable speakers or screen sharing, replay approval, and draft status updates.",
          ],
          [
            "主持链接与公共观看链接分离；回放、聊天与观众名单各自确认保存期限，不把彩排成功写成直播成功。",
            "Separate host and public viewing links. Verify retention for replay, chat, and attendee lists independently; rehearsal success is not a successful broadcast.",
          ],
        ],
        [
          ["混合会议执行", "Hybrid meeting operations"],
          [
            "按现场和远端分别走通听见、看见、提问及投票四个动作，让双端主持都知道发言与共享控制权何时交接。",
            "Test hearing, viewing, questions, and voting at both sites so both hosts know when speaking and screen-sharing control change hands.",
          ],
          [
            "收集会场音频回路、麦克风分区、远端讲者的独立时区字段、屏幕内容与兜底网络的实测记录。",
            "Gather room audio routing, microphone zones, separate timezones for remote speakers, on-screen content, and actual backup-network tests.",
          ],
          [
            "制作双端并列的提示单，标出同传、主持切换、讨论区问题回收、离线材料和重连判断的执行人。",
            "Create a two-sided cue sheet covering interpretation, host transfer, chat question collection, offline material, and reconnect decisions with owners.",
          ],
          [
            "核对跨区日期和夏令时；单侧音画通过不代表另一侧有效，无回声消除或备用网络尚未实测时不可标绿。",
            "Check cross-region dates and daylight saving. Passing audio or video on one side does not validate the other; do not mark echo cancellation or a backup network ready without tests.",
          ],
        ],
        [
          ["讲者邀约与准备", "Speaker coordination"],
          [
            "把讲者流程分为邀约、议题确认、授权、收稿、彩排和现场报到，给演讲超时和讲者临时取消设置接替流程。",
            "Stage invitation, topic, consent, material collection, rehearsal, and check-in; plan a substitute for overruns or late cancellations.",
          ],
          [
            "收集已批准称谓、简介和照片、主题与时长、课件版本、提问方式、授权媒体和出场顺序确认。",
            "Gather approved name and title, biography and photo, topic and duration, slide version, Q&A format, media permissions, and confirmed running order.",
          ],
          [
            "输出以讲者为索引的材料台账、缺件提醒草稿、一次联排用提示单及只显示已授权信息的公共简介。",
            "Deliver a speaker-indexed materials register, draft missing-item reminders, a rehearsal cue sheet, and public bios containing approved details only.",
          ],
          [
            "出场确认不包含素材转授权；旧课件、未确认人名照片和私人联络途径不得进入可分发日程。",
            "Agreement to speak does not grant material reuse. Exclude old slides, unconfirmed names or photos, and private contacts from distributable schedules.",
          ],
        ],
        [
          ["活动报名管理", "Event registration management"],
          [
            "定义报名、资格核验、确认、候补、取消和签到的转换规则，空位释放按批准的候补顺序处理。",
            "Define transitions through registration, eligibility, confirmation, waitlist, cancellation, and check-in; release seats in the approved waitlist order.",
          ],
          [
            "收集可用席位、分会场配额、唯一报名键、授权字段、通知时间与服从的人工例外规则。",
            "Gather available seats, breakout quotas, unique registration keys, consented fields, notification times, and manual exception rules.",
          ],
          [
            "用状态汇总揭示空位、已确认和待核人数，另列候补递补建议、重复记录冲突及签到台的最小字段视图。",
            "Summarize vacant, confirmed, and pending seats; separately list proposed waitlist offers, duplicate conflicts, and a minimal check-in view.",
          ],
          [
            "候补人数不得计入可入场人数；历史报名不是本次联系许可，未发送通知及未确认递补不能当已占位。",
            "Do not count waitlisted people as admitted. Past registration is not consent to future contact; unsent notices and unconfirmed offers do not reserve seats.",
          ],
        ],
        [
          ["会场物资清点", "Event materials inventory"],
          [
            "按会场区域和使用时段盘点标识、耗材、设备及备件，为布置、补货、借出和回收定义交接点。",
            "Count signage, consumables, equipment, and spares by zone and use time; define handoffs for setup, replenishment, loan, and recovery.",
          ],
          [
            "收集物料编号、计量单位、锁定数量、暂存地、货单与实收照片，区分租赁物资和现场消耗品。",
            "Gather item IDs, units, reserved counts, staging locations, delivery slips, and receipt photos; distinguish rentals from consumables.",
          ],
          [
            "交付每区的领用和退还表，计算实收缺口，在同一记录留下调拨、残损、替代来源及到场责任。",
            "Deliver issue and return sheets by zone, calculate receipt shortages, and trace transfers, damage, alternate sources, and receiving owners.",
          ],
          [
            "同批物资不能在共享区和分会场各算一遍；未批准补购不算到货，租赁缺损与正常消耗分别复核。",
            "Do not count a shared lot again for each breakout; unapproved replenishment is not received, and rental losses are reviewed separately from consumption.",
          ],
        ],
        [
          ["供应商交付跟踪", "Event supplier delivery"],
          [
            "把搭建与用电、餐饮与供餐、技术彩排拆成可验收承诺；标出前序依赖、进场窗口及逾期的替代交付。",
            "Break setup and power, catering and service, and technical rehearsal into testable commitments; show dependencies, access windows, and late-delivery alternatives.",
          ],
          [
            "收集有效合同版本、订单行、报价限制、到场人员授权、单项验收口径、送货及撤场安排。",
            "Gather the effective contract, order lines, quote constraints, staff authorizations, item acceptance criteria, delivery, and teardown plans.",
          ],
          [
            "生成供应商交付矩阵、到场与签收序列、整改项治理表，并给控制预算与审批节点的引用编号。",
            "Produce a supplier delivery matrix, arrival and sign-off sequence, and remediation log with budget and approval reference IDs.",
          ],
          [
            "口头通知不算正式变更；验收、发票和付款状态独立，需交叉核对签字证据，不代替采购确认新增费用。",
            "Verbal notices are not formal changes. Keep acceptance, invoicing, and payment states separate, verify signatures, and do not approve added costs on procurement's behalf.",
          ],
        ],
        [
          ["现场流程与串场", "Run of show and transitions"],
          [
            "把议程拆为后台站位、主持上场、媒体播放、台前动作和交接信号，逐段预设超时可删减的低优先内容。",
            "Translate the agenda into backstage position, host entrance, media, front-of-house action, and handoff cues; identify low-priority segments to shorten if late.",
          ],
          [
            "收集审定议程、主持脚本、讲者读音、影片时长、素材最终路径及咪位和灯光工作人员的确认。",
            "Gather the approved agenda, host script, speaker pronunciation, clip durations, final asset paths, and microphone and lighting crew confirmation.",
          ],
          [
            "形成分钟级导播表，列计划和实播时点、执行口令、负责人、尾部留白以及由谁确认进入下一段。",
            "Produce a minute-by-minute cue sheet: plan, actual time, command, owner, buffer, and who confirms the next segment can start.",
          ],
          [
            "视频时长、翻译、撤换舞台和转场需真实留时；认不出的素材、未测试口令和排期冲突不能按已就绪发布。",
            "Budget real time for clips, interpretation, stage changes, and transitions; unknown assets, untested cues, and scheduling conflicts must not be marked ready.",
          ],
        ],
        [
          ["会务突发应对", "Event contingency response"],
          [
            "按讲者失联、断电断网、场地不可用及人为延误分别定义触发、接单人、首轮沟通和升级时点。",
            "For speaker unavailability, power or network loss, unavailable venue, and delays, define triggers, triage owners, initial communications, and escalation timing.",
          ],
          [
            "收集场地方有效预案、值班联络树、可出场备用讲者、可用设备、延迟容忍时间以及谁能决定暂停。",
            "Gather the venue's approved contingency plan, on-call contacts, available backup speakers and equipment, delay limits, and authority to pause.",
          ],
          [
            "提供可现场翻阅的触发与动作表、备用资源占用表、更新话术草案和恢复后记录实际影响的表单。",
            "Provide a quick trigger-action sheet, backup resource assignments, draft status copy, and a post-recovery impact record.",
          ],
          [
            "事故处置以场地方和当地应急规定为准，策划稿不能替代指挥；未演练路线、未联系值班人都列待确认。",
            "Defer to venue and local emergency procedures; this planning draft is not incident command. Flag untested routes and unconfirmed on-call contacts.",
          ],
        ],
        [
          ["活动预算结算", "Event budget settlement"],
          [
            "以合同或批准费用编号连接承诺、收货、发票和支付明细，按预算科目找超支、预付款与尚未结清差额。",
            "Join commitments, receipt, invoices, and payments by contract or approval ID, identifying overspend, deposits, and open balances by budget category.",
          ],
          [
            "收集预算基线、变更批复、含税条款、发票号码、预付冲抵、退款或折扣及财务付款回执。",
            "Gather baseline budget, approved changes, tax terms, invoice numbers, deposit offsets, refunds or discounts, and finance payment receipts.",
          ],
          [
            "交付预算差异桥表、重复票据和无单支出清单、归档索引以及由财务标记结算关闭的责任栏。",
            "Deliver a variance bridge, duplicate invoice and undocumented expense lists, archive index, and finance-owned closeout field.",
          ],
          [
            "不把报价、应付款和已支付混算；多币种先确认汇率日期和税额口径，没有有效回执不能标记结清。",
            "Do not combine quotes, payables, and payments. Confirm exchange-rate dates and tax definitions, and do not close balances without valid receipts.",
          ],
        ],
        [
          ["活动复盘与跟进", "Event review and follow-up"],
          [
            "按原目标对照真实到场、议题完成、临场事件和满意度，提炼值得保留、取消和验证的具体动作。",
            "Compare actual turnout, topic completion, live issues, and satisfaction against goals; isolate actions to keep, stop, or test.",
          ],
          [
            "收集签到去重汇总、反馈题目、回应率、现场偏差、会务投入和已登记待办，注明统计截止与角色分布。",
            "Gather deduplicated check-ins, survey questions, response rate, execution changes, costs, and recorded actions with cutoff and role distribution.",
          ],
          [
            "交付目标结果对照、典型问题证据、行动优先表和下次会前复查日期，为每项改进指明证据和负责人。",
            "Deliver goals versus actuals, evidence of typical issues, an action priority list, and the next pre-event review date with owners and evidence.",
          ],
          [
            "主动反馈者不代表全部人群；评价须脱敏，不把计划参与、注册和签到混作出席，也不要把一次活动当长期趋势。",
            "Voluntary responses do not represent everyone. De-identify feedback, separate expected, registered, and checked-in counts, and do not infer long-term trends from one event.",
          ],
        ],
      ],
    ),
  },
  {
    id: "account-strategy",
    name: ["重点客户经营", "Strategic account planning"],
    category: "planning",
    format: "PPTX",
    summary: [
      "围绕重点客户目标、关系与协作机会制定经营计划",
      "Plan strategic accounts around customer outcomes, relationships, and collaboration opportunities",
    ],
    style: ["审慎、客户导向、决策清楚", "Thoughtful, customer-oriented, and decision-clear"],
    sections: [
      [
        "account",
        "客户概况",
        "Account overview",
        "说明客户范围、背景与资料时点。",
        "State account scope, background, and source dates.",
      ],
      [
        "goals",
        "客户目标",
        "Customer objectives",
        "记录客户确认目标和关键约束。",
        "Record customer-confirmed objectives and constraints.",
      ],
      [
        "relationship",
        "合作关系",
        "Relationship map",
        "梳理授权联系人、职责及沟通记录。",
        "Map authorized contacts, roles, and communications.",
      ],
      [
        "opportunities",
        "机会与证据",
        "Opportunities and evidence",
        "区分已验证需求与待检验机会。",
        "Separate validated needs from opportunities to test.",
      ],
      [
        "risks",
        "风险与依赖",
        "Risks and dependencies",
        "列出交付、关系及决策依赖。",
        "List delivery, relationship, and decision dependencies.",
      ],
      [
        "plan",
        "行动与决策",
        "Actions and decisions",
        "提出责任、日期及需要批准的决定。",
        "Specify owners, dates, and decisions needing approval.",
      ],
    ],
    acceptance: [
      [
        "客户事实与内部推测分开并注明来源日期。",
        "Separate customer facts and internal hypotheses with source dates.",
      ],
      [
        "经营行动对应客户价值、责任人及确认节点。",
        "Account actions map to customer value, owners, and confirmation points.",
      ],
      [
        "未经确认的机会、关系和收益不写为承诺。",
        "Unconfirmed opportunities, relationships, and benefits are not commitments.",
      ],
    ],
    workflow: [
      [
        "收集授权客户资料与已有合作记录。",
        "Gather authorized account materials and engagement history.",
      ],
      ["确认客户目标和关系信息的证据。", "Validate evidence for customer goals and relationships."],
      ["形成机会、风险和可执行选择。", "Develop opportunities, risks, and actionable options."],
      ["与责任人复核并定期更新。", "Review with owners and update periodically."],
    ],
    playbook: {
      inputs: [
        "收集客户公开背景、经授权的合同与合作范围、客户确认目标、相关业务单元、已知联系人职责、项目交付、服务问题和会议纪要；注明每项信息来源、时间及分享权限。缺少决策人或计划时保留未知，不搜索或推断客户私人信息。",
        "Gather public account background, authorized contract and engagement scope, customer-confirmed goals, business units, known contact roles, delivery, service issues, and meeting notes. Record sources, dates, and sharing permissions; leave decision makers or plans unknown rather than seeking private personal information.",
      ],
      method: [
        "先以客户目标和当前合作事实形成基线，再梳理利益相关方、交付价值、未满足需求和可验证机会；对每个机会说明依据、假设、所需客户确认、能力边界及内部资源。分别制定关系维护、问题处理和阶段决策，不以个人关系或猜测替代事实。",
        "Establish a baseline from customer goals and existing engagement, then map stakeholders, delivered value, unmet needs, and testable opportunities. For each opportunity specify evidence, assumptions, customer confirmation, capability boundaries, and internal resources; plan relationship, issue, and stage decisions without substituting guesses for facts.",
      ],
      design: [
        "使用简洁的客户概览、目标证据、关系职责图、机会筛选、风险与行动路线，重要结论放标题，图表保留时间和来源；联系人仅展示获授权的业务角色。保持可编辑对象、页间一致的层级和足够空白，避免用装饰图形掩盖证据不足。",
        "Use a concise account overview, goal evidence, relationship responsibilities, opportunity assessment, risks, and action roadmap. Put conclusions in headings and dates and sources on charts; display only authorized business roles, retain editable objects and consistent spacing, and never use decoration to conceal weak evidence.",
      ],
      checks: [
        "对照合同、客户记录和公开来源核对事实及日期，检查每个机会的客户确认状态、资源、风险和决策责任；不把内部目标写成客户承诺。逐页检查文字、图形和备注的完整性与访问范围，无法核验的客户数据或渲染结果必须标明。",
        "Verify facts and dates against contracts, customer records, and public sources; review customer-confirmation state, resources, risks, and decision owners for each opportunity. Do not turn internal targets into client commitments. Inspect slide content, objects, notes, and access, disclosing unverified customer data or rendering.",
      ],
    },
    scenarios: scenarios(
      [
        "重点客户经理、业务负责人及交付团队",
        "Strategic account managers, business owners, and delivery teams",
      ],
      {
        focus: [
          "以客户已确认的目标和当前合作事实为基线，区分待验证机会、责任、风险与阶段决策。",
          "Use customer-confirmed goals and existing engagement as the baseline, distinguishing unvalidated opportunities, ownership, risks, and decisions.",
        ],
        inputs: [
          "核对公开资料、合同范围、沟通证据、资料日期、责任人和共享权限，未知信息保持待确认。",
          "Check public sources, contract scope, communication evidence, dates, owners, and sharing rights; leave unknowns pending.",
        ],
        output: [
          "形成可编辑的客户经营汇报、证据与假设、行动责任和复审节点，支持团队讨论与修订。",
          "Deliver an editable account briefing with evidence, assumptions, action owners, and review points for team discussion.",
        ],
        risk: [
          "不得推断个人隐私、虚构关系或收益；未获客户与内部批准的方案不能写成正式承诺。",
          "Do not infer private details or invent relationships or benefits; proposals without customer and internal approval are not commitments.",
        ],
      },
      [
        [
          ["重点客户年度计划", "Annual strategic account plan"],
          [
            "按客户年度目标、已有在途交付与团队能力排定各季度优先项；每一项都指明为什么此时做及放弃什么。",
            "Prioritize quarterly initiatives by annual customer goals, work in flight, and team capacity, stating why each matters now and what it displaces.",
          ],
          [
            "收集客户经营节奏、上年已验收成果、合同续签节点、预算季、授权角色以及我方可用的支持和交付资源。",
            "Gather business cadence, accepted prior-year work, contract renewal dates, budget season, authorized roles, and available support and delivery capacity.",
          ],
          [
            "按客户目标、履约责任、联合探索三条线画年度路线，附重点取舍、分季负责人及改动路线的复核触发点。",
            "Show annual tracks for customer outcomes, contractual responsibilities, and joint exploration, with trade-offs, quarterly owners, and triggers to revisit the plan.",
          ],
          [
            "把内部营收目标和客户认可的合作两栏分开；考虑客户预算未落实的保守路线，不承诺超出已确认资源的日期。",
            "Separate internal revenue targets from customer-approved work. Offer a conservative route if funding is unconfirmed and do not promise dates outside confirmed capacity.",
          ],
        ],
        [
          ["客户关系地图", "Account relationship map"],
          [
            "按流程区分业务发起、产品使用、采购验收、合同批准和服务联系，标出哪些职责实为同一角色兼职。",
            "Map business sponsors, users, procurement acceptance, contract approvers, and service contacts, noting where one role handles multiple duties.",
          ],
          [
            "使用获授权的组织资料、会议纪要、确认日期、职责交接与客户认可的业务沟通渠道，不收集私人资料。",
            "Use authorized organization records, meeting notes, confirmation dates, responsibility handoffs, and approved business channels, without private information.",
          ],
          [
            "呈现以角色为节点的职责与沟通图，列出欠缺的单点联系人、代理人和下次由谁核对角色及分享授权。",
            "Show a role-based responsibility and communication map with missing points of contact, deputies, and who will reconfirm roles and sharing rights.",
          ],
          [
            "把已确认、过期资料和待核角色用文字区分；不以社交媒体或个人关系推断决策权，不把客户内部图公开传播。",
            "Label confirmed, stale, and unknown roles in text. Do not infer authority from social media or personal relationships or circulate internal org charts publicly.",
          ],
        ],
        [
          ["客户目标对齐", "Customer objective alignment"],
          [
            "将每个客户目标连到相应服务或交付证据，按已覆盖、部分覆盖、不在合同范围及待客户澄清分类。",
            "Link each customer goal to service or delivery evidence and classify full, partial, out-of-scope, or needs customer clarification.",
          ],
          [
            "收集客户原话或认可纪要、目标衡量方式与期间、合同或工作说明书、实际交付和被排除的范围。",
            "Gather customer wording or approved notes, outcome measures and time horizon, contracts or statements of work, actual deliverables, and exclusions.",
          ],
          [
            "输出目标与证据匹配页、最大差距的先后取舍、客户需确认的具体问题和内部可行性评估的责任人。",
            "Provide goal-to-evidence mapping, trade-offs for the largest gaps, specific customer questions, and owners for internal feasibility review.",
          ],
          [
            "不能把我们的产品指标当客户业务结果；对未获认可的映射注明假设，不据此擅自扩服务范围或承诺收益。",
            "Do not substitute product metrics for the customer's business outcomes. Mark unapproved mappings as hypotheses without extending scope or promising benefits.",
          ],
        ],
        [
          ["跨部门客户协同", "Cross-functional account collaboration"],
          [
            "用销售移交、交付验收、运维跟进和升级四类流程梳理断点，给每项未结事项设置唯一接手人。",
            "Trace sales handoff, delivery acceptance, operations follow-up, and escalation to identify breaks, with one receiving owner per open item.",
          ],
          [
            "收集现有职责、工单或项目编号、客户承诺时点、各团队排期、共享权限、待跨团队确认的交付物。",
            "Gather responsibility assignments, ticket or project IDs, customer commitment dates, team schedules, sharing rights, and deliverables requiring joint sign-off.",
          ],
          [
            "交付交接清单和决策责任图，明确下一次同步、逾期升级及客户对外沟通由谁合并口径。",
            "Deliver a handoff checklist and responsibility map covering the next sync, overdue escalation, and who consolidates outward messaging.",
          ],
          [
            "并列团队同时接手易导致重复响应；以唯一更新位置和最小共享字段规避，不把内部分歧转给客户决策。",
            "Parallel ownership can create duplicate responses. Use one update location and minimal fields; do not hand internal disagreements to the customer to resolve.",
          ],
        ],
        [
          ["客户机会筛选", "Account opportunity qualification"],
          [
            "以客户实际痛点、匹配度、业务价值、取得证据成本和实施窗口为筛选项，比较推进、访谈和暂缓。",
            "Compare pursue, interview, and defer options by verified pain, fit, value, cost of evidence, and implementation window.",
          ],
          [
            "收集点名的客户需求、现行流程及替代方案、已有验收规模、准备和维护成本、决策角色及目标时间。",
            "Gather explicit needs, current workflows and alternatives, accepted scale, preparation and maintenance cost, decision roles, and target dates.",
          ],
          [
            "用一条机会一条证据的对照页记录分级理由、最低验证动作、放弃条件及需请求的内部资源。",
            "Give each opportunity an evidence row with ranking rationale, smallest validation action, drop conditions, and requested internal resources.",
          ],
          [
            "不得凭赞同发言判定有预算、有权采购或已有项目；机会排序不是业绩预测，未核实效益只能以明确假设表示。",
            "Positive feedback does not establish budget, buying authority, or a project. Ranking is not a forecast; label any unverified benefit as an assumption.",
          ],
        ],
        [
          ["客户风险预警", "Account risk review"],
          [
            "将交付延期、重复服务问题、客户已提出顾虑及合同未决项分开，先用真实影响和节点远近判定优先级。",
            "Separate delivery delays, recurring support issues, expressed concerns, and contractual open items; prioritize by actual impact and proximity to milestones.",
          ],
          [
            "收集工单发生时间、重复次数、角色级客户反馈、服务约定、影响范围以及已有整改和双方的确认记录。",
            "Gather incident dates, recurrence counts, role-level feedback, service obligations, impact scope, and recorded mitigations and acknowledgments.",
          ],
          [
            "提供风险证据与可信度、触发线、行动人、下次核对日期；区分需立即升级、需补充验证及继续观察。",
            "Provide evidence and confidence, trigger, owner, and next review, distinguishing immediate escalation, more validation, and observation.",
          ],
          [
            "没有反馈不代表不满或满意，舆情与直接证据分开；尚未解决的症状不准标作根因，不擅自对外定责。",
            "Silence proves neither dissatisfaction nor satisfaction. Separate hearsay from direct evidence, do not label symptoms root causes, and do not assign blame externally.",
          ],
        ],
        [
          ["高层会面准备", "Executive meeting preparation"],
          [
            "将高层会议压缩为已知业务背景、需要解决的一项决策及两到三个可讨论选项，先确定对方参会角色的权限。",
            "Center executive discussion on verified context, one decision, and two or three options after confirming what the attending roles can decide.",
          ],
          [
            "收集双方已同意议程、上一轮承诺、关键数字的口径及日期、场合礼仪、禁谈主题和可对外使用材料。",
            "Gather agreed agenda, prior commitments, definitions and dates of key figures, meeting protocol, off-limit topics, and approved external materials.",
          ],
          [
            "输出开场页、选项权衡页、决策问题和附录答题卡，另列会后纪要及哪些内容需要双方书面确认。",
            "Provide an opening, options and trade-offs, decision question, appendix talking points, and follow-up minutes and written confirmation needs.",
          ],
          [
            "区分可分享简报与内部谈判备注；无授权不得承诺价格、赔偿、交期或服务范围，高层参与不等于同意。",
            "Separate a shareable brief from internal negotiating notes. Do not promise prices, compensation, timing, or scope without authorization; attendance is not consent.",
          ],
        ],
        [
          ["客户联合规划", "Joint account planning"],
          [
            "把双方目标分别列出后找交集，对共同目标设出起点、责任边界、可见成果及计划失效时的调整机制。",
            "List each side's objectives before defining shared baselines, responsibility boundaries, visible outcomes, and how to adjust if assumptions fail.",
          ],
          [
            "收集双方授权范围、既有合同、人员可用性、客户关键日历、共享资料政策和待确认的前后顺序。",
            "Gather each side's authority, existing contracts, staffing, customer dates, sharing policy, and sequencing questions.",
          ],
          [
            "给一页联合路线、双方承诺草案与假设表，分出须客户确认、须内部批准以及双方见证后才能关闭的项目。",
            "Provide a joint roadmap, draft commitments, and assumptions, distinguishing customer confirmation, internal approvals, and items requiring both parties to close.",
          ],
          [
            "利益冲突和范围分歧保留并列方案；内部讨论稿不能冠以共同确认，发现资源冲突应先协商而非许诺时点。",
            "Keep competing interests and scope differences visible as alternatives. Do not present an internal draft as joint agreement or promise dates through a capacity conflict.",
          ],
        ],
        [
          ["重点客户服务复盘", "Strategic account service review"],
          [
            "按约定的服务期与有效分母核对响应、处理和恢复，分出按时完成、合同例外、重复问题和仍需行动。",
            "Review response, resolution, and recovery against the agreed period and denominator, distinguishing on-time work, contractual exceptions, repeats, and open actions.",
          ],
          [
            "收集合同服务级别、生效日、工单含时区时间戳、暂停计时理由、影响记录、纠正措施及反馈样本。",
            "Gather SLA terms and effective dates, ticket timestamps and zones, stop-clock reasons, impact records, corrective actions, and feedback samples.",
          ],
          [
            "用趋势和事项页展示工作数量、可核对的达标分子分母、反复出现的主题及改进动作的关闭标准。",
            "Show volumes, auditable SLA numerators and denominators, recurring themes, and action closeout criteria on trends and issue slides.",
          ],
          [
            "不要用平均响应隐藏严重超时；合同范围外或缺失时点独立标注，未经客户确认的改进不等于验收。",
            "Do not hide severe delays behind average response. Mark out-of-scope cases and missing times separately; proposed changes are not customer acceptance.",
          ],
        ],
        [
          ["客户组织变化应对", "Customer organization change"],
          [
            "用已确认的新旧职责对照检查项目审批、材料接收、工单升级和合同通知四条链路是否断开。",
            "Use confirmed old and new roles to check for breaks in project approval, material receipt, support escalation, and contractual notices.",
          ],
          [
            "收集公开公告或客户认可记录、生效时点、临时代理安排、在途事项、约定的对外联系人和分发边界。",
            "Gather public or customer-approved records, change dates, acting roles, pending items, agreed external contacts, and distribution boundaries.",
          ],
          [
            "提供受影响事项地图、需客户确认的代办人及到期风险，列首次问候、资料移交和权限复核的执行顺序。",
            "Map affected work, items needing a customer-confirmed delegate, and deadline risks; sequence introductions, document handoffs, and access review.",
          ],
          [
            "未经确认的调任传闻和个人原因不得入稿；新对接人出现也不代表原合同变更或授权自动转移。",
            "Exclude rumored role changes and private motives; a new point of contact does not change a contract or automatically transfer authority.",
          ],
        ],
        [
          ["合同到期前规划", "Pre-expiry account planning"],
          [
            "从当前合同有效期倒排通知、续签讨论或有序退出，以既有交付和服务证明支持比较续签、改版及到期。",
            "Work backward from the effective expiry for notice, renewal discussion, or orderly offboarding, comparing renewal, revision, and expiry using delivery evidence.",
          ],
          [
            "收集合约到期条款、通知时限、指定收件角色、在途款项、资料返还义务、服务结果及内外部批准路径。",
            "Gather expiry terms, notice periods and recipient roles, open amounts, data-return obligations, service results, and internal and external approval paths.",
          ],
          [
            "交付按日期排列的证据准备和决策清单，标明内部讨论、客户意向、已签署及到期退出分别需要哪些动作。",
            "Provide a dated evidence and decision checklist identifying the actions for internal discussion, customer intent, signature, and expiry offboarding.",
          ],
          [
            "非授权人给出的回复不是合同同意；不得代发通知或续订，合同效力和终止义务交由有权人员核对。",
            "Replies from unauthorized roles are not agreement. Do not send notices or renew automatically; have authorized reviewers assess effectiveness and termination duties.",
          ],
        ],
        [
          ["合作方案变更", "Account engagement change"],
          [
            "以正在履行的基线为准，将变更拆成范围、工期、资源和验收四类差异，对照拒绝、分阶段和一次性实施。",
            "Compare reject, phased, and full implementation against the active baseline across scope, schedule, resources, and acceptance.",
          ],
          [
            "收集书面请求、基线和条款版本、交付依赖、承诺日程、未用余额、单次与持续成本，以及需续签的授权。",
            "Gather the written request, baseline and terms, dependencies, committed dates, remaining allowance, one-time and ongoing costs, and authorizations to renew.",
          ],
          [
            "提供基线与建议变更标注、关键影响、成本假设、批准和实施责任，并给出变更不获准时的沟通与原计划。",
            "Show baseline and proposed changes, key impacts, cost assumptions, approvals, and owners, with communication and baseline steps if rejected.",
          ],
          [
            "需求澄清不代表接受变更；不要替换原证明或自动改项目计划，须先核对双方批准及更新时间点。",
            "Clarifying a request is not approval. Do not overwrite baseline evidence or change project plans automatically; verify both approvals and effective dates first.",
          ],
        ],
      ],
    ),
  },
  {
    id: "internal-communications",
    name: ["内部沟通", "Internal communications"],
    category: "document",
    format: "DOCX",
    summary: [
      "编写准确、易读且明确行动的内部沟通材料",
      "Write accurate, readable internal communications with clear actions",
    ],
    style: ["真诚、简洁、尊重不同受众", "Direct, concise, and respectful of different audiences"],
    sections: [
      [
        "purpose",
        "目的与受众",
        "Purpose and audience",
        "明确沟通对象、背景和期望结果。",
        "Identify the audience, context, and intended outcome.",
      ],
      [
        "message",
        "核心信息",
        "Core message",
        "优先说明已确认的事实及其影响。",
        "Lead with confirmed facts and their implications.",
      ],
      [
        "details",
        "适用范围",
        "Scope and details",
        "说明影响人群、时间、例外与条件。",
        "Explain affected groups, timing, exceptions, and conditions.",
      ],
      [
        "actions",
        "行动要求",
        "Required actions",
        "列出读者需要采取的行动和截止时间。",
        "List reader actions and deadlines.",
      ],
      [
        "questions",
        "常见问题",
        "Questions and answers",
        "回应可预期问题并承认未知。",
        "Address likely questions and acknowledge unknowns.",
      ],
      [
        "contact",
        "反馈与更新",
        "Feedback and updates",
        "明确咨询渠道、责任人与下次更新时间。",
        "Provide contacts, owners, and the next update time.",
      ],
    ],
    acceptance: [
      [
        "信息、适用范围和生效时间均有来源及批准。",
        "Information, applicability, and effective dates have sources and approval.",
      ],
      [
        "受众能快速找到影响、行动、时间和咨询渠道。",
        "Readers can find impact, actions, timing, and help quickly.",
      ],
      [
        "未知事项诚实标明，不代替正式制度或法律意见。",
        "State unknowns honestly; do not substitute for formal policy or legal advice.",
      ],
    ],
    workflow: [
      ["确认事实、受众和发文授权。", "Confirm facts, audience, and publishing authority."],
      ["编写核心信息、影响和行动。", "Draft the message, impact, and actions."],
      ["核对常见问题、敏感性和审批。", "Review questions, sensitivities, and approval."],
      ["由负责人确认发布及后续更新。", "Have owners confirm publication and follow-up."],
    ],
    playbook: {
      inputs: [
        "收集沟通目标、已批准事实、受影响人群、关键日期、适用制度、发文人、联系人和既有沟通记录；确认信息密级、发布日期及受众语言。对不完整的决定、个人信息和可能引发误解的内容列出待确认项，不将内部猜测写成公告。",
        "Gather the communication goal, approved facts, affected groups, key dates, applicable policy, sender, contacts, and prior communications. Confirm classification, publication date, and audience language; flag incomplete decisions, personal information, and ambiguous content rather than presenting speculation as announcement.",
      ],
      method: [
        "先概括发生了什么、哪些人受影响、何时生效以及读者需要做什么，再按真实背景补充原因、条件、常见问题和反馈渠道；对尚未决定的事项说明下一次更新责任及时间。避免命令式或空洞措辞，不代替人力、法务和业务负责人审批。",
        "Lead with what happened, who is affected, when it takes effect, and what readers should do. Add verified context, conditions, likely questions, and feedback channels; for undecided items identify an owner and update date. Avoid hollow or coercive language and obtain people, legal, and business approvals where needed.",
      ],
      design: [
        "文档首页突出标题、发布日期、适用范围和核心行动，使用语义标题、短段落和必要的行动表格；复杂步骤按顺序排列，联系方式与常见问题可快速定位。保持语气平实尊重、字号对比和适度留白，依据接收范围移除不必要的个人资料。",
        "Make the title, publication date, applicability, and core action easy to find on page one. Use semantic headings, short paragraphs, necessary action tables, ordered steps, and accessible contacts and FAQs; maintain a respectful voice, readable hierarchy and spacing, and remove unnecessary personal data.",
      ],
      checks: [
        "逐项对照来源核实数字、政策版本、日期、受众、链接和负责人，检查行动是否可执行且截止时间一致；由授权人员审阅敏感内容及外发范围。生成后复核标题、表格、分页和可访问性，未批准或未发送的内容明确标为草案。",
        "Verify numbers, policy versions, dates, audiences, links, and owners against their sources; check that actions are achievable and deadlines consistent. Obtain authorized review of sensitive content and distribution; inspect headings, tables, pagination, and accessibility, labeling unapproved or unsent content as a draft.",
      ],
    },
    scenarios: scenarios(
      [
        "内部沟通负责人、团队管理者和员工",
        "Internal communications owners, managers, and employees",
      ],
      {
        focus: [
          "围绕受众关心的事实、影响、行动和时间撰写清晰信息，区分已批准内容与仍未决定的事项。",
          "Write around the audience's facts, impact, actions, and timing, distinguishing approved information from decisions still pending.",
        ],
        inputs: [
          "核对信息来源、适用范围、负责人、生效日期和发布权限，缺失的决定或资料明确列出。",
          "Check sources, applicability, owners, effective dates, and publication authority; explicitly list missing decisions or materials.",
        ],
        output: [
          "交付可编辑的通知正文、必要问答、责任人与咨询渠道，保留草稿和审批状态供后续核对。",
          "Deliver editable communication copy, necessary FAQs, owners, support contacts, and draft and approval states for review.",
        ],
        risk: [
          "不得自行发送或虚构政策、承诺和个人信息；涉及员工权益及敏感问题须由授权人员审核。",
          "Do not send automatically or invent policy, commitments, or personal information; authorized reviewers must examine employee-rights and sensitive matters.",
        ],
      },
      [
        [
          ["制度变更通知", "Policy change notice"],
          [
            "逐条比较旧规则与批准的新规则，先告诉员工哪些情形、人员和日期受影响，再说明过渡期怎么处理。",
            "Compare previous and approved new rules clause by clause; lead with affected scenarios, people, dates, and how to handle transition cases.",
          ],
          [
            "收集带版本号的制度原文、承办和批准角色、生效及废止日期、还在办理中的例外流程及官方咨询渠道。",
            "Gather versioned policy text, owner and approver roles, effective and retirement dates, in-progress exceptions, and approved help channels.",
          ],
          [
            "交付首屏影响摘要、变化对照表、在途事项的处理示例和针对不同岗位的行动，附完整制度文档位置。",
            "Deliver a first-page impact summary, change table, in-flight examples, actions by role, and the location of the complete policy.",
          ],
          [
            "尚未批准和口头例外只能放在待定稿；不自行解释劳动权益，冲突条款请制度负责人复核再定发文。",
            "Keep unapproved changes and verbal exceptions pending. Do not independently interpret employment rights; have the policy owner resolve conflicting clauses before release.",
          ],
        ],
        [
          ["系统维护通知", "System maintenance notice"],
          [
            "按功能说明停用、只读、延迟或完全不受影响，给正办理中的员工明确保存、暂停及恢复后补办动作。",
            "Distinguish unavailable, read-only, delayed, and unaffected functions; tell employees with in-progress work what to save, pause, and resume afterward.",
          ],
          [
            "收集系统与环境标识、起止时间和独立时区、适用地点、绕行渠道、恢复判据、服务台和下一次通报时点。",
            "Gather system and environment IDs, start and end with separate zones, affected locations, workarounds, restoration criteria, service desk, and update time.",
          ],
          [
            "制作预约提醒、维护当日简通知及待恢复确认稿，每版都保留时间、受影响动作、替代选项和权威状态页。",
            "Draft a planning notice, same-day reminder, and pending restoration update; retain time, impacted actions, alternatives, and the authoritative status location in each.",
          ],
          [
            "跨日维护需核对夏令时和本地日期；恢复须由运维确认，不将预计窗口写成承诺，也不公开内部机器标识。",
            "Verify daylight saving and dates for overnight maintenance. Operations must confirm restoration; do not guarantee estimated times or disclose internal machine identifiers.",
          ],
        ],
        [
          ["项目进度通告", "Project status update"],
          [
            "用上期承诺对照当前交付，解释进度变化、阻塞对下游的影响及本期真正需要其他团队决定的事项。",
            "Compare previous commitments with current delivery, explaining schedule changes, downstream effects of blockers, and actual decisions needed from other teams.",
          ],
          [
            "收集报告截止日、基线及最新计划、里程碑验收证据、阶段风险、下游依赖和该帮忙事项的单一负责人。",
            "Gather reporting cutoff, baseline and current plan, milestone acceptance evidence, stage risks, downstream dependencies, and one owner for each request.",
          ],
          [
            "编写短摘要和里程碑变化表，注明已交付、已验收、进行中、风险中及暂缓，每个请求给希望答复日期。",
            "Write an executive summary and milestone-change table, distinguishing delivered, accepted, active, at risk, and on hold; date each response request.",
          ],
          [
            "完成百分比要有统一依据，不能用已开始覆盖延期；没有证据的验收留空，未经确认不能宣布新承诺日期。",
            "Use a defensible progress denominator; started work does not erase delays. Leave acceptance unverified and do not announce unconfirmed new commitments.",
          ],
        ],
        [
          ["跨部门协作请求", "Cross-team collaboration request"],
          [
            "把协作拆成一个可答复请求：为什么需要、对方交付什么、何时确认能否接下、若不能如何降级。",
            "Write one answerable request: why it is needed, what the recipient should deliver, when to confirm capacity, and what to scale back if unavailable.",
          ],
          [
            "收集请求人的权限、下游里程碑、所需格式或字段、接受标准、可提供的资料和对方已有工作限制。",
            "Gather requester authority, downstream milestone, required formats or fields, acceptance criteria, materials offered, and recipient constraints.",
          ],
          [
            "交付可转发短稿和一页附件规格，给确认、拒绝、协商三种回复路径，列验收人和跟进日期。",
            "Deliver a forwardable message and one-page specification, with accept, decline, and negotiate reply paths, acceptance owner, and follow-up date.",
          ],
          [
            "拟议日期和已承诺日期不得混写；让对方确认成本及排期，保留知情范围，避免用升级语气暗示强制接受。",
            "Distinguish proposed and committed dates. Let the recipient confirm cost and capacity, restrict distribution, and avoid language implying forced acceptance.",
          ],
        ],
        [
          ["会议决议传达", "Meeting decision communication"],
          [
            "先从原纪要划出已批准决定、待批准提案和信息同步，再把对未参会角色有影响的变化转写为行动。",
            "Extract approved decisions, pending proposals, and information items from minutes before translating changes into actions for absent roles.",
          ],
          [
            "收集纪要版本、会议日期、授权决策人、决议编号、执行边界、异议及被替代的此前决定。",
            "Gather minutes version, meeting date, authorized decision maker, resolution ID, implementation boundary, objections, and superseded decisions.",
          ],
          [
            "交付决定摘要、受影响角色行动表、依赖与截止日，并给质疑或发现纪要不符时的更正渠道。",
            "Deliver a decision digest, actions by affected role, dependencies and deadlines, and how to request correction if minutes conflict.",
          ],
          [
            "不将反对意见抹成一致同意；未受授权的会议议题不得宣称有约束力，控制涉及人事或客户的分发。",
            "Do not erase dissent into consensus or describe unauthorized topics as binding. Control distribution for personnel or customer matters.",
          ],
        ],
        [
          ["组织变动沟通", "Organizational change communication"],
          [
            "按员工第一周会遇到的审批、汇报、服务入口及跨组交接编排说明，给新旧流程和生效日的并排对照。",
            "Organize around first-week approval, reporting, support, and handoff needs, with side-by-side old and new workflows and effective dates.",
          ],
          [
            "收集人事审定范围、生效时间、授权公布的职责、暂代安排、在途事项处理和直属管理者可回答的问答。",
            "Gather approved people-team scope, effective date, publishable roles, acting assignments, in-flight work treatment, and manager-approved answers.",
          ],
          [
            "交付员工正文、管理者简要口径和交接对照图，区分通用回答、个案转接以及仍需人工决定的问题。",
            "Provide employee copy, short manager talking points, and a handoff map, distinguishing general answers, private referrals, and open decisions.",
          ],
          [
            "不发布私人人事原因或揣测离任；不能替代正式任免与权益说明，临时职责不写成永久授权。",
            "Do not publish private employment reasons or speculate on departures. This is not a formal appointment or rights notice; acting roles are not permanent authority.",
          ],
        ],
        [
          ["员工活动邀请", "Employee event invitation"],
          [
            "用平实语气说明谁能参加、能获得什么、需要投入多少时间以及出席是否完全自愿，必须有清晰退订途径。",
            "State who can join, the benefits and time commitment, whether attendance is entirely voluntary, and how to cancel or opt out.",
          ],
          [
            "收集活动议程、有效名额、时区或详细入口、无障碍和饮食支持、报名方式、摄影与个人资料授权范围。",
            "Gather the agenda, capacity, times and entrances, accessibility and dietary support, registration method, and photo and data permissions.",
          ],
          [
            "形成主题行、短通知和详细邀请，列参与步骤、取消和候补规则、费用与截止日；附管理员确认清单。",
            "Provide a subject line, short notice, and detailed invitation with steps, cancellation and waitlist rules, fees, deadlines, and an organizer checklist.",
          ],
          [
            "自愿活动不得暗示影响绩效，也不要让经理查看个人拒绝理由；尚未确认的抽奖或福利不作为承诺。",
            "Never imply effects on performance or expose personal decline reasons to managers; do not promise unconfirmed prizes or benefits.",
          ],
        ],
        [
          ["培训安排通知", "Training schedule notice"],
          [
            "先区分必修、选修和面向特定岗位的培训，再按报名、预习、上课、补课与完成登记说明步骤。",
            "Distinguish mandatory, elective, and role-specific training, then explain enrollment, preparation, attendance, make-up, and completion recording.",
          ],
          [
            "收集课程目标、讲师资格和启用状态、员工班次、先修要求、平台、访问权限、语言及可用补训时段。",
            "Gather objectives, instructor confirmation, shifts, prerequisites, platform and access, language, and available make-up slots.",
          ],
          [
            "交付培训通知和分角色准备表，写明完成依据、无法参加的处理方式和管理员在哪里核对名单。",
            "Provide the training notice and role-based preparation table with completion evidence, absence handling, and where administrators verify enrollment.",
          ],
          [
            "不能把登录记录当作掌握技能；课程、补训或认证效力未经确认要标出，讲师和材料权限以批准为准。",
            "Login does not prove proficiency. Flag unconfirmed sessions, make-ups, or certification; use only approved instructor and material permissions.",
          ],
        ],
        [
          ["办公地点调整通知", "Office location change notice"],
          [
            "按旧址停止、新址首次进场和迁移过渡列操作，分别写明员工、外来访客与寄件者需要调整什么。",
            "Describe old-site closure, first entry to the new site, and transition, distinguishing what employees, visitors, and senders must change.",
          ],
          [
            "收集批准地址和楼层、门禁办理、班车及公共交通、无障碍入口、工位安排、旧址寄送与设施开放日期。",
            "Gather the approved address and floor, badge process, transport, accessible access, seating, mail forwarding, and facility opening dates.",
          ],
          [
            "交付一页首日到场清单、旧新地点切换时间表和可打印的入口指引，标注无障碍咨询和设施工单渠道。",
            "Provide a first-day checklist, cutover timeline, and printable entrance instructions with accessibility assistance and facilities ticket channels.",
          ],
          [
            "不得公开个人通勤例外、门禁码或未确认工位；地点与交通须由设施负责人复核，施工区不当作可用入口。",
            "Exclude personal commute exceptions, entry codes, and unconfirmed seating; have facilities verify locations and routes, and do not direct people through worksites.",
          ],
        ],
        [
          ["突发事件状态更新", "Incident status update"],
          [
            "以有时间戳的事实快照说明当前影响、员工需要采取的临时步骤和下一次更新时间，旧更新保留归档。",
            "Use a timestamped factual snapshot for current impact, interim employee steps, and the next update, retaining earlier updates in the archive.",
          ],
          [
            "收集事件编号、响应负责人确认的影响和状态、仍在核查的问题、可分享处置措施、时区和指定发言人。",
            "Gather incident ID, response-approved impact and status, unresolved questions, shareable mitigations, time zone, and designated spokesperson.",
          ],
          [
            "交付首报、变化播报与恢复待审稿，分别保留员工可执行操作、可靠查询位置及下一步何时更新。",
            "Draft initial, change, and recovery updates, each with actionable steps, an authoritative status source, and next update timing.",
          ],
          [
            "不猜测原因或责任；已缓解与已恢复须分开，未批准的调查记录、受影响人员身份和服务凭据不得入稿。",
            "Do not speculate on cause or fault. Distinguish mitigated from restored, and exclude unapproved investigation notes, identities, and credentials.",
          ],
        ],
        [
          ["员工反馈征集", "Employee feedback request"],
          [
            "先交代某项决定可以被反馈影响到什么程度，用开放但具体的问题收集建议，并提供非线上参与方式。",
            "Explain which parts of a decision feedback can change, use focused open questions, and offer an offline participation option.",
          ],
          [
            "收集可反馈议题、目标受众、沟通渠道、可读取身份的角色、数据保留期限、截止时间和结果回传安排。",
            "Gather topics, audience, channels, who can see identities, retention, deadlines, and plans to report results back.",
          ],
          [
            "交付征集说明、主问题和补充提示、归纳口径及结果反馈稿框架，标明投诉与紧急个案的独立渠道。",
            "Deliver the invitation, core and optional questions, aggregation rules, and a results draft, with separate channels for complaints and urgent cases.",
          ],
          [
            "可匿名填写不代表管理员无法识别；未经核验不许诺匿名，样本很小时不发布可反推到个人的引用或分组。",
            "Anonymous input does not mean administrators cannot identify people. Do not promise anonymity before verification or publish identifiable quotes or tiny segments.",
          ],
        ],
        [
          ["阶段成果分享", "Milestone achievement update"],
          [
            "从完成的具体交付和可核对的变化说起，交代哪些团队承担了哪些工作，以及成果如何支持后续目标。",
            "Lead with the actual deliverable and verifiable changes, credit concrete team contributions, and show how the outcome supports next objectives.",
          ],
          [
            "收集交付验收记录、数据起止时点、口径和基线、参与团队及获准公开的案例、照片和客户引语。",
            "Gather acceptance evidence, measurement dates, definitions and baselines, contributing teams, and permission for examples, photos, and customer quotes.",
          ],
          [
            "出一条简讯和详细分享稿，包含数字说明、团队贡献、仍待关注的限制、下一阶段动作及反馈方式。",
            "Provide a short announcement and longer story with metric definitions, contributions, unresolved limits, next actions, and feedback channels.",
          ],
          [
            "不要把阶段成果当最终商业价值或将关联写成因果；发布前核对未获授权姓名、商业数字和敏感图片。",
            "Do not describe interim outcomes as final value or association as causation; review names, commercial metrics, and images for publication rights.",
          ],
        ],
      ],
    ),
  },
];
