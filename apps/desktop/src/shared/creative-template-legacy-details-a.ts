import type { CreativeAuthoredScenario, CreativeTranslation } from "./creative-template-authoring";

type Detail = Pick<CreativeAuthoredScenario, "inputs" | "focus" | "output" | "risk">;

const detail = (
  inputs: CreativeTranslation,
  focus: CreativeTranslation,
  output: CreativeTranslation,
  risk: CreativeTranslation,
): Detail => ({ inputs, focus, output, risk });

export const LEGACY_DETAILED_CASES_A: Readonly<Record<string, readonly Detail[]>> = {
  "decision-deck": [
    detail(
      [
        "收集立项申请、业务基线、收益测算、分阶段预算、资源工时、依赖清单及授权矩阵，标注来源日期和估计责任人。",
        "Collect the request, baseline, benefit estimate, phased budget, effort, dependencies and authorization matrix with dated sources and estimate owners.",
      ],
      [
        "以不立项为基准比较完整建设、缩小范围和暂缓，分期计算增量投入与可验证收益，并说明每条路径占用的关键资源。",
        "Compare full scope, reduced scope and deferral against no project; phase incremental costs, verifiable benefits and critical resources.",
      ],
      [
        "交付决策页和选项比较表，逐项列出投入期间、收益指标、关键假设、责任人、首阶段拨款及下一次复核节点。",
        "Deliver a decision page and options table showing timing, benefits, assumptions, owners, first-stage funding and the next review.",
      ],
      [
        "收益依据缺失、预算超授权上限或关键依赖未落实时列为待决，不把拟定拨款写成已批准，列明触发退出或重审的信号。",
        "Leave the decision open when evidence, authority or dependencies are missing; distinguish proposed funding from approval and state exit triggers.",
      ],
    ),
    detail(
      [
        "收集按时段需求、现有产能、利用率、峰值负载、扩容报价、交付周期、服务水平和不同业务时段的需求峰谷记录，并注明容量单位与采样窗口。",
        "Collect time-based demand peaks and troughs, capacity, utilization, expansion quotes, lead times and service records with units and sample windows.",
      ],
      [
        "分别计算日常与峰值需求下的容量余量，比较立即扩容、分批扩容和借用资源的边际成本、上线时间及撤回难度。",
        "Calculate normal and peak headroom; compare immediate, staged and borrowed capacity by marginal cost, lead time and reversibility.",
      ],
      [
        "交付容量曲线、峰值缺口表及扩容节点评审页，列出各方案新增量、费用、负责人、监测频率和复核日期。",
        "Deliver capacity curves, peak-gap tables and an expansion gate with incremental capacity, costs, owners and review dates.",
      ],
      [
        "持续负载和短时尖峰须分开，增长假设未验证或备用容量低于业务确认的安全线时暂停扩容决策并补测。",
        "Separate sustained load from peaks; pause when growth is unvalidated or reserve falls below the business-approved safety limit.",
      ],
    ),
    detail(
      [
        "收集已完成工作、未付合同承诺、停工成本、未交付清单、用户影响、恢复依赖与相关方通知期限，记录统计截止日。",
        "Collect completed work, unpaid commitments, pause costs, outstanding deliverables, user impact, restart dependencies and notice deadlines.",
      ],
      [
        "比较继续、受控暂停和结束收尾的未来现金支出、服务影响及恢复周期，已发生且不可回收的费用单列不重复计入。",
        "Compare future cash, service impact and restart time for continuation, pause and closure; separate sunk costs from future decisions.",
      ],
      [
        "输出停复工选项表、合同通知清单和遗留事项台账，逐项注明责任人、保全动作、恢复前置条件及复查日期。",
        "Provide pause/restart options, contract notices and an open-items register with custodians, preservation, prerequisites and review dates.",
      ],
      [
        "合同通知期限、数据保管责任或必要服务交接未确认时不得宣布安全暂停，暂停期限和恢复条件应由授权人决定。",
        "Do not declare a safe pause before notices, data custody and essential-service handoffs are confirmed; authorized owners set restart terms.",
      ],
    ),
    detail(
      [
        "收集各团队人员可用工时、现有任务承诺、预算余额、项目优先级、交付日期、关键岗位替补名单及跨团队依赖，说明数据统计周期。",
        "Collect team capacity, commitments, remaining budget, project priority, deadlines, critical-role backups and cross-team dependencies with the reporting period.",
      ],
      [
        "按优先级和技能匹配计算可调剂工时，比较人员借调与顺延计划，同时列出让出资源后受影响的原有承诺。",
        "Calculate transferable capacity by priority and skill; compare reassignment with delay and expose commitments displaced by the change.",
      ],
      [
        "交付资源调整前后对照表、受影响里程碑清单及交接计划，写明调出调入负责人、开始结束日和复盘频率。",
        "Deliver before/after allocations, affected milestones and handoff plans with both owners, dates and review cadence.",
      ],
      [
        "借调后关键岗位缺口、人员超负荷或交接无人接收时暂停实施；未经双方确认的可用工时不得计作已经释放。",
        "Pause for critical staffing gaps, overload or unaccepted handoffs; do not count unconfirmed capacity as released.",
      ],
    ),
    detail(
      [
        "收集现行价目、客户合同约定、分层成交量、单位成本、折扣及退订记录，并标记不同价格生效时间和样本区间。",
        "Collect current prices, contract terms, segment volumes, unit costs, discounts and churn with effective dates and sample periods.",
      ],
      [
        "比较维持、分层调整及统一调价，按客户群计算收入和毛利变化，并在不同销量反应假设下进行敏感性分析。",
        "Compare unchanged, segmented and uniform pricing; estimate revenue and gross margin by segment under multiple volume-response assumptions.",
      ],
      [
        "交付价格情景矩阵、客户影响分层表与实施时间线，分别展示假设销量、测算收益、合同限制及客户沟通责任。",
        "Deliver pricing scenarios, segment impacts and an implementation timeline showing volume assumptions, modeled returns, contract limits and communication owners.",
      ],
      [
        "价格弹性缺少实验或历史支持时只能作为假设；合同锁价、退订上升超过已批准阈值或样本过小时须暂停推广复核。",
        "Treat unsupported elasticity as an assumption; review contract locks, small samples and churn above the approved threshold before rollout.",
      ],
    ),
    detail(
      [
        "收集目标区域的可触达客户、渠道能力、竞争报价、准入资料、进入成本、本地服务资源和客户调研样本构成，并记录数据年份与来源。",
        "Collect addressable customers, channels, competitor pricing, entry requirements, costs, local support capacity and research sample composition with source dates.",
      ],
      [
        "从可服务市场而非总市场出发，比较小范围试点、伙伴进入和独立进入的投入、学习速度、回收周期及退出成本。",
        "Use serviceable rather than total market size to compare pilot, partner and direct entry by cost, learning, payback and exit burden.",
      ],
      [
        "输出区域机会表、准入依赖清单及分阶段投资卡，标出目标样本、验证问题、责任人、评审门槛与停止选项。",
        "Produce a regional opportunity table, entry dependencies and staged investment cards with sample, validation questions, owners and stop gates.",
      ],
      [
        "法规、渠道授权或市场样本尚未核实时不得宣称可以进入；试点效果低于约定门槛时停止扩投并记录退出责任。",
        "Do not claim entry readiness without verified rules, channel rights and market evidence; stop expansion below agreed pilot gates.",
      ],
    ),
    detail(
      [
        "收集候选供应商报价、履约案例、资质有效期、交货能力、服务条款、财务风险信息、替代供应来源、财务审计意见及评审人利益冲突声明。",
        "Collect supplier quotes, references, valid qualifications, capacity, service terms, financial risk, alternatives, audit opinions and reviewer conflict declarations.",
      ],
      [
        "先筛查必须满足的准入条件，再按经批准的质量、成本、交期与服务权重评分，分别呈现缺证项目和敏感性。",
        "Screen mandatory eligibility first, then score approved quality, cost, delivery and service weights; expose missing evidence and sensitivity.",
      ],
      [
        "交付候选人评分矩阵、总拥有成本比较表和尽调问题清单，列出权重、证据链接、未决条款及替补供应商。",
        "Deliver a supplier scorecard, total-cost comparison and due-diligence questions with weights, evidence, open terms and alternatives.",
      ],
      [
        "证照过期、关联关系未申报或核心条款未经法务确认不得标为合格；低价不得抵消未满足的强制安全条件。",
        "Do not qualify expired credentials, undisclosed conflicts or unreviewed terms; low price cannot offset mandatory safety failures.",
      ],
    ),
    detail(
      [
        "收集渠道投放成本、触达人数、线索来源、各阶段转化、成交收入、客户首次接触时间、自然流量基线及归因窗口，标识重复触达和客户分群。",
        "Collect channel spend, reach, lead sources, funnel conversions, revenue, first-touch dates, organic baseline and attribution windows, identifying duplicate touches and segments.",
      ],
      [
        "以一致窗口比较各渠道获客成本和增量转化，设置维持、转移预算及小额试验方案，说明多渠道触点归因方法。",
        "Compare acquisition cost and incremental conversion over consistent windows; model unchanged, reallocated and test budgets with attribution rules.",
      ],
      [
        "输出渠道漏斗表、预算组合比较和实验设计，标明人群、对照组、投入上限、观察周期及复盘负责人。",
        "Deliver funnel tables, budget comparisons and experiment designs with audience, control, spend cap, observation period and owner.",
      ],
      [
        "曝光不能当成交，归因重复或样本不足时不据单一成本排名；效果低于约定阈值应暂停试投而非扩大预算。",
        "Do not equate impressions with sales or rank on cost when attribution overlaps or samples are weak; stop tests below agreed gates.",
      ],
    ),
    detail(
      [
        "收集风险事件、影响对象、发生依据、现有控制、历史损失、类似事件的发生时间、恢复所需工时及控制负责人，注明评估日期、证据来源和适用范围。",
        "Collect risk events, affected parties, likelihood evidence, controls, historical losses, comparable incident dates, recovery effort and control owners with dates and scope.",
      ],
      [
        "比较规避、降低、转移与接受的剩余风险、实施成本和所需权限，用区间或等级说明不确定性而非伪造概率。",
        "Compare avoidance, mitigation, transfer and acceptance by residual risk, cost and authority; express uncertainty without fabricated probabilities.",
      ],
      [
        "交付处置选择表、风险触发指标及行动台账，明确风险所有者、补充控制、目标日期、例外期限和复审会议。",
        "Deliver treatment options, triggers and an action register with risk owners, controls, deadlines, exception expiry and review.",
      ],
      [
        "剩余风险超过已批准承受度、控制未验证或接受人无权限时不得记为可接受，升级并保留未决状态。",
        "Escalate residual risk above approved tolerance, untested controls or unauthorized acceptance; retain an open status.",
      ],
    ),
    detail(
      [
        "收集例外申请范围、现行制度条款、申请原因、受影响对象、拟采用的补偿控制、同类历史申请及其审批结果、有效期限及授权审批矩阵。",
        "Collect the exception scope, policy clause, rationale, affected parties, compensating controls, comparable requests and decisions, duration and approval matrix.",
      ],
      [
        "比较遵循原制度、调整方案与限期例外的可行性，核对补偿措施覆盖的缺口，并指定到期检查与撤销条件。",
        "Compare compliance, alternatives and a time-limited exception; assess coverage of compensating controls and define expiry checks.",
      ],
      [
        "输出例外决策卡和控制跟踪表，记录适用对象、批准人、临时措施、到期日、证据、责任人及恢复标准。",
        "Deliver an exception decision card and control tracker with scope, approver, safeguards, expiry, evidence, owners and restoration criteria.",
      ],
      [
        "无授权审批、补偿措施未部署或到期未复核时不得延用例外；同类申请数量增长应触发制度复审而非自动复制。",
        "Do not extend unapproved, unimplemented or expired exceptions; rising repeat requests trigger policy review rather than automatic reuse.",
      ],
    ),
    detail(
      [
        "收集业务影响分析、关键服务清单、恢复目标、备份与冗余配置、最近一次恢复演练记录、备份保存地点、停机成本及各方案报价和依赖。",
        "Collect business-impact analysis, critical services, recovery objectives, backup, redundancy, latest restore-drill records, backup locations, outage costs and quotes.",
      ],
      [
        "按关键服务比较不同投入对应的恢复时间、可接受数据损失与覆盖范围，区分理论设计目标和演练实测结果。",
        "Compare recovery time, data-loss tolerance and service coverage by investment, separating design targets from drill results.",
      ],
      [
        "交付连续性投资对照表、恢复依赖图和演练计划，逐项标注负责人、预算、恢复点、测试日期及验证状态。",
        "Deliver investment comparisons, recovery dependencies and a drill plan with owners, budgets, recovery points, dates and verification status.",
      ],
      [
        "备份未验证可恢复、关键依赖未纳入演练或实测超出批准目标时不得宣称连续性达标，应提交缓解及复测。",
        "Do not claim continuity compliance when restore tests are missing, critical dependencies untested or measured recovery exceeds approved targets.",
      ],
    ),
    detail(
      [
        "收集变更请求、受影响系统及客户、依赖版本、测试报告、维护窗口、审批权限、历史变更故障记录、值守名单和可用回退资源。",
        "Collect the change request, affected systems and customers, dependencies, tests, maintenance window, approvers, prior change failures, on-call staff and rollback resources.",
      ],
      [
        "比较一次实施、分批变更和延期的风险暴露与业务影响，为每一批定义进入条件、观察窗口、停止信号及回退步骤。",
        "Compare single, phased and deferred changes by exposure and impact; define entry, observation, stop and rollback conditions for each wave.",
      ],
      [
        "交付授权决策页、批次执行表和回退核对表，列出变更负责人、批准记录、监控指标、沟通对象及恢复验证人。",
        "Deliver an authorization page, wave plan and rollback checklist with owners, approvals, monitoring, communications and recovery verifier.",
      ],
      [
        "未获变更授权、关键测试失败或监控触及批准的停止阈值时不得继续；未演练回退不能标记为已验证可恢复。",
        "Do not proceed without authorization or after failed critical tests or stop thresholds; untested rollback is not verified recovery.",
      ],
    ),
  ],
  "company-narrative": [
    detail(
      [
        "收集公司成立背景、产品实际功能、服务范围、公开规模指标、经许可案例、关键里程碑及对外联系人和事实核验来源。",
        "Collect company background, actual products, service scope, public figures, approved cases, milestones, contacts and verification sources.",
      ],
      [
        "从客户遇到的问题出发，串联公司能力、实施方式和可核验证据，分别标出已经提供的服务与尚在规划的方向。",
        "Connect customer problems to actual capabilities, delivery and verifiable evidence; distinguish available services from plans.",
      ],
      [
        "形成公司概览页、能力证据对应表和联系页，每项公开数字注明统计时点，案例配授权状态、结果口径和来源。",
        "Create an overview, capability-evidence table and contact page; date figures and document case permissions and result definitions.",
      ],
      [
        "客户名称、标识或经营数据未经许可不得外发；缺少来源的市场排名及业务成果不能以确定事实展示，应留待核实。",
        "Do not publish client identifiers or operating data without permission, or state unsupported rankings and results as facts.",
      ],
    ),
    detail(
      [
        "收集客户行业背景、会前沟通纪要、参会角色、已披露需求、相关能力清单和授权案例，记录仍待客户确认的问题。",
        "Collect the client's industry, pre-meeting notes, attendees, disclosed needs, relevant capabilities and authorized cases; note open questions.",
      ],
      [
        "先复述客户处境与理解假设，再挑选能回应当前问题的能力和证据，安排讨论问题而非预设客户已经接受方案。",
        "Restate the client's context and assumptions, then select relevant capability evidence and discussion questions without presuming agreement.",
      ],
      [
        "交付会谈简报、需求与能力对应表及会后问题清单，注明每位参会人的关注点、讨论时间和下一步确认责任。",
        "Deliver a meeting brief, needs-to-capability map and follow-up questions with attendee interests, timing and confirmation owners.",
      ],
      [
        "需求来自间接资料须标注假设；价格、交期和客户案例没有授权时不得作为承诺，对客户敏感信息实行最小披露。",
        "Label secondhand needs as assumptions; do not promise unauthorized prices or dates or disclose sensitive client information.",
      ],
    ),
    detail(
      [
        "收集双方业务定位、已有产品接口、合作协议状态、客户覆盖、共同案例授权、拟议试点范围及商务、技术和法务联系窗口。",
        "Collect both parties' positioning, interfaces, agreement status, customer coverage, case permissions, proposed pilot scope and business, technical and legal contacts.",
      ],
      [
        "用具体客户任务说明能力互补，区分已有合作成果、需要验证的联合方案及双方尚未承诺的资源投入和责任。",
        "Explain complementary capabilities through customer tasks, distinguishing existing results from unverified proposals and uncommitted resources.",
      ],
      [
        "制作双方能力映射图、联合价值表及合作推进清单，列出接口依赖、业务负责人、拟议动作和协议确认状态。",
        "Create a capability map, joint-value table and action list with interface dependencies, owners and agreement status.",
      ],
      [
        "未经书面许可不展示伙伴标识或客户名称；尚未签署的分工、数据交换和收入安排不得写成正式合作条款。",
        "Do not use partner marks or client names without written permission, or present unsigned roles, data sharing or revenue terms as agreed.",
      ],
    ),
    detail(
      [
        "收集活动议题、听众构成、演讲时长、公开演讲要求、行业统计来源、案例许可、现场设备条件、问答时段和翻译安排及主办方日程。",
        "Collect the event theme, audience, duration, speaking rules, public statistics, case rights, equipment, question period, interpretation and organizer schedule.",
      ],
      [
        "围绕一个行业矛盾组织问题、证据、实践与行动建议，按演讲时间安排节奏，并为听众预留有针对性的提问。",
        "Structure one industry tension around the problem, evidence, practice and action; pace the talk and reserve audience questions.",
      ],
      [
        "交付演讲提纲、逐页论点与来源清单以及计时表，标出可公开案例、演讲人提示和无法回答时的跟进联系人。",
        "Deliver an outline, slide claims and citations, and a timing sheet with authorized cases, speaker cues and follow-up contacts.",
      ],
      [
        "过期统计、不可公开材料或未经证实的行业排名不得上台引用；设备与演讲时长未确认时准备文字和缩短版本。",
        "Exclude stale statistics, confidential material and unsupported rankings; prepare text and short versions when equipment or timing is uncertain.",
      ],
    ),
    detail(
      [
        "收集已批准岗位说明、真实工作任务、招聘流程、团队项目实例、工作地点、岗位汇报关系和薪酬福利中允许公开的已确认信息。",
        "Collect approved role descriptions, actual work, hiring steps, project examples, locations, reporting lines and verified compensation information cleared for disclosure.",
      ],
      [
        "用一周工作样例说明岗位职责、协作对象和成长支持，区分必备条件与可培养能力，并展示客观一致的评估方式。",
        "Use a workweek example to explain duties, collaborators and development; separate required from learnable skills and show consistent assessment.",
      ],
      [
        "制作岗位任务页、招聘阶段表及候选人问答清单，列明申请渠道、反馈节点、负责人以及资料有效期限。",
        "Create role-task slides, a hiring-stage table and candidate FAQ with application channels, feedback timing, owners and validity dates.",
      ],
      [
        "不得编造薪酬福利或晋升承诺，年龄、性别等无关条件不作筛选标准，候选人的个人信息只在授权范围处理。",
        "Do not invent benefits or promotion promises, use irrelevant protected traits as criteria, or process candidate data beyond authorization.",
      ],
    ),
    detail(
      [
        "收集入职手册、首周日程、团队职责、经批准的产品演示、办公支持渠道、导师名单、新人首个任务样例及其验收标准和可访问的资料链接。",
        "Collect the onboarding handbook, first-week schedule, team roles, approved demos, support channels, mentors, a first-task example and acceptance criteria and accessible links.",
      ],
      [
        "以新人首周的真实任务串联组织使命、团队接口与求助方式，按当天需要组织材料，避免一次性堆放全部制度。",
        "Connect mission, team interfaces and help channels to real first-week tasks, sequencing information by when it is needed.",
      ],
      [
        "交付欢迎课件、首周行动卡和联系人表，写明账户申请入口、首次协作任务、导师确认点与资料更新日期。",
        "Deliver welcome slides, first-week action cards and contacts with access requests, initial tasks, mentor checkpoints and update dates.",
      ],
      [
        "链接失效、导师变更或账号未开通时标记待办并提供替代联系人，不能把展示流程当作权限已经授予。",
        "Flag broken links, changed mentors and missing access with alternatives; presenting a process does not grant permissions.",
      ],
    ),
    detail(
      [
        "收集校园活动时间、参会专业背景、实习或校招岗位、申请条件、面试流程、公开项目素材、宣讲场地与报名人数及校园联络方式。",
        "Collect campus event timing, disciplines, internship and graduate roles, application requirements, interview steps, public projects, venue, registrations and contacts.",
      ],
      [
        "围绕学生能够理解的问题介绍团队任务和可参与项目，区分实习与正式岗位，并按已批准要求说明申请过程。",
        "Explain team problems and accessible projects, distinguish internships from permanent roles, and describe approved application steps.",
      ],
      [
        "输出校园宣讲稿、岗位与技能对应表、申请时间线和常见问题页，列出有效招聘渠道及反馈责任人。",
        "Deliver campus slides, role-skill mapping, application timeline and FAQ with valid recruiting channels and feedback owners.",
      ],
      [
        "截止日期、岗位数量或录用条件未确认时标注待公布，不承诺录用结果；展示项目时移除未经许可的客户资料。",
        "Mark unconfirmed deadlines, openings and terms as pending, promise no offer, and remove unauthorized client material from examples.",
      ],
    ),
    detail(
      [
        "收集团队职责、真实项目决策记录、协作流程、工作样例、经同意的成员反馈、项目结果数据及相邻团队的交接关系。",
        "Collect team responsibilities, real project decisions, collaboration workflows, work samples, consented feedback, project outcomes and adjacent-team handoffs.",
      ],
      [
        "选择具体项目呈现团队为什么作出取舍、如何与其他岗位协作和如何衡量结果，将未来愿景与现有事实分开。",
        "Use concrete projects to explain tradeoffs, collaboration and measurement, separating future aspirations from current facts.",
      ],
      [
        "制作使命到项目映射页、协作接口图和行动清单，逐项列出例子、责任团队、观察到的结果与需要补充的证据。",
        "Create mission-to-project mapping, interface diagrams and actions showing examples, owners, observed outcomes and evidence gaps.",
      ],
      [
        "成员反馈须经同意并避免可识别敏感评价；没有项目证据的文化或成效描述不得包装成所有成员的共同体验。",
        "Obtain consent for feedback and omit identifiable sensitive evaluations; do not generalize unsupported culture claims to everyone.",
      ],
    ),
    detail(
      [
        "收集年度目标版本、实际经营指标、重大项目、经确认贡献、目标调整审批、期间变更与复盘记录，并核对统计期间和指标定义。",
        "Collect annual goal versions, actual metrics, major projects, verified contributions, goal-change approvals and retrospectives with consistent definitions.",
      ],
      [
        "将年初目标与年末实际逐项对照，解释目标变更、未完成原因和可复用经验，区分团队成果与外部条件影响。",
        "Compare original goals with actual results, explaining changes, shortfalls and lessons while separating team contributions from external factors.",
      ],
      [
        "交付目标达成表、年度时间线和改进行动页，列出原目标、实际值、差异说明、证据、负责人和下次复核日期。",
        "Deliver a goal-versus-actual table, annual timeline and actions with variance explanations, evidence, owners and review dates.",
      ],
      [
        "缺失的实际值保留未知，不以预测代替已实现结果；涉及个人表彰、客户和财务数字时须核对授权与公开范围。",
        "Leave missing actuals unknown, never substitute forecasts for results, and verify disclosure rights for individuals, clients and financial figures.",
      ],
    ),
    detail(
      [
        "收集原战略、新方向决议、转型动因、受影响流程与团队、阶段资源、决策会议纪要、反馈渠道与沟通记录和尚未形成结论的问题。",
        "Collect the prior strategy, new-direction decisions, transition rationale, affected teams and workflows, resources, decision minutes, feedback channels, communications and open issues.",
      ],
      [
        "解释为什么调整、哪些原则保持不变以及各团队需要改变的行动，将已批准决定、备选方案和待听取意见分层。",
        "Explain the rationale, enduring principles and team actions, distinguishing approved decisions, alternatives and topics open for input.",
      ],
      [
        "交付新旧方向对照表、受影响团队行动图和问答台账，列明决策来源、关键日期、反馈渠道与负责回应的人。",
        "Deliver an old/new comparison, affected-team actions and FAQ register with decision sources, dates, feedback channels and response owners.",
      ],
      [
        "人员安排和预算尚未确定时明确未知，不将拟议调整描述为已经生效；涉及岗位影响的信息按授权控制披露。",
        "State unknown staffing and budgets, do not portray proposals as effective decisions, and restrict disclosure of personnel impacts.",
      ],
    ),
    detail(
      [
        "收集已确认的公司事件、日期、产品发布、组织变化、项目成果和当时的公告记录，附历史材料出处、图片权利、事实核验人及可公开范围。",
        "Collect verified company events, dates, launches, organizational changes, outcomes and contemporaneous announcements with historical sources, image rights, fact-checkers and disclosure scope.",
      ],
      [
        "按照发生顺序选择对业务产生具体影响的节点，说明事件背景、实际结果及与后续业务的关联，避免虚构因果。",
        "Select chronologically ordered milestones with concrete business effects, explaining context and results without inventing causation.",
      ],
      [
        "制作时间线、里程碑证据表和素材清单，每行注明事件日期、主要贡献、公开级别、引用来源和事实核验人。",
        "Create a timeline, evidence table and asset list with dates, contributions, disclosure levels, citations and fact-check owners.",
      ],
      [
        "日期冲突或成果归属不清时保留待核，未经许可的老照片、客户标识及个人信息不得进入对外版本。",
        "Leave conflicting dates or unclear attribution unresolved; exclude unauthorized historical photos, client marks and personal data from public versions.",
      ],
    ),
    detail(
      [
        "收集正式愿景表述、年度重点、各团队职责与目标、资源约束、依赖关系、已经确认的协作项目以及仍需管理层决定的问题。",
        "Collect the approved vision, annual priorities, team responsibilities and goals, resource constraints, dependencies, confirmed joint projects and leadership decisions outstanding.",
      ],
      [
        "将长期愿景拆解为本年度团队贡献和跨团队取舍，逐项说明当前可执行动作、需要协调的依赖及衡量方式。",
        "Translate the vision into this year's team contributions and tradeoffs, with executable actions, dependencies and measures.",
      ],
      [
        "交付愿景到目标映射表、跨团队协作请求和开放问题清单，列出责任人、时间、决策状态及后续反馈窗口。",
        "Deliver vision-to-goal mapping, cross-team requests and open questions with owners, dates, decision status and feedback windows.",
      ],
      [
        "尚未批准的指标和资源不得标成团队承诺；目标之间存在冲突或责任空缺时提交决策，而不是通过口号掩盖。",
        "Do not present unapproved targets or resources as commitments; escalate conflicting goals and ownership gaps instead of masking them.",
      ],
    ),
  ],
  "product-launch": [
    detail(
      [
        "收集功能需求批准记录、支持的操作环境、发布候选版本、测试缺陷清单、帮助页面和当班联系人，并标明资料更新时间。",
        "Collect approved requirements, supported environments, release candidate, test defects, help pages and on-call contacts with update dates.",
      ],
      [
        "围绕目标用户的首个实际任务安排价值说明、可用范围和启用步骤，逐项区分已经上线、受限开放与后续计划功能。",
        "Organize value, availability and activation around users' first task, separating released, restricted and planned capabilities.",
      ],
      [
        "交付发布概览、功能与环境兼容表、已知问题清单和支持路径，列出责任团队、修复状态、观察指标及公告更新时间。",
        "Deliver a launch overview, feature compatibility table, known issues and support path with owners, status, metrics and update time.",
      ],
      [
        "测试未通过、关键环境不支持或修复时点未确认时须明确限制，不能以营销文案掩盖缺陷，也不得把候选版称为正式可用。",
        "State limits when tests fail, environments are unsupported or fixes are unconfirmed; do not call a candidate generally available.",
      ],
    ),
    detail(
      [
        "收集当前版与候选版变更记录、客户端和服务器依赖、升级操作、迁移脚本、兼容矩阵、验证报告及回退演练结果。",
        "Collect current-to-candidate changes, client and server dependencies, upgrade steps, migrations, compatibility, tests and rollback drills.",
      ],
      [
        "按依赖顺序比较直接升级、分批升级及暂缓方案，核算停机窗口和用户影响，说明每阶段升级前后的验证方法。",
        "Compare direct, staged and deferred upgrades by dependency order, downtime and user impact, with checks before and after each phase.",
      ],
      [
        "输出版本差异表、受影响环境列表、升级执行时间线和恢复检查表，逐项注明执行人、审批点、备份位置及成功判据。",
        "Produce a version-difference table, affected environments, upgrade timeline and recovery checklist with operators, approvals, backups and success criteria.",
      ],
      [
        "迁移脚本未在代表性副本验证、依赖版本冲突或恢复备份不可读取时暂停升级，并将未支持环境标成需人工评估。",
        "Pause when migrations lack representative testing, dependencies conflict or backups cannot be read; flag unsupported environments for review.",
      ],
    ),
    detail(
      [
        "收集试点申请、候选客户名单、设备与版本分布、邀请时间、样本量依据、支持排班、反馈问题及预先批准的退出规则。",
        "Collect the pilot request, customer cohort, device and version mix, invitations, sample rationale, support rota, feedback and approved exit rules.",
      ],
      [
        "将试点目标拆成可观察的任务完成率、缺陷严重度和支持负荷，安排基线、观察窗口及反馈访谈，不把兴趣表达算作成功。",
        "Translate pilot goals into observable task completion, defect severity and support load, with baselines and interviews, not interest alone.",
      ],
      [
        "交付试点章程、参与批次表、每周指标看板和复盘决议模板，分别记录反馈证据、问题责任人、扩展建议与待批准事项。",
        "Deliver a pilot charter, cohort schedule, weekly metrics and review template tracking evidence, owners, expansion advice and approvals.",
      ],
      [
        "样本偏向高熟练客户、支持容量不足或严重缺陷越过批准阈值时应暂停招募；参与者同意和数据使用范围须留有记录。",
        "Pause recruitment for biased samples, inadequate support or severe defects above the approved threshold; record consent and data-use scope.",
      ],
    ),
    detail(
      [
        "收集拟灰度账户分组、当前版本、功能开关配置、线上监控、客服值守、错误预算及已经审核的回滚步骤和权限。",
        "Collect rollout cohorts, current versions, feature flags, monitoring, support coverage, error budgets and approved rollback steps and authority.",
      ],
      [
        "按用户风险和系统依赖规划小批次放量，为每批设定观察时长、对照指标和加量门槛，并区分新增错误与历史基线。",
        "Stage cohorts by user risk and dependencies, defining observation periods, comparison metrics and gates while separating new errors from baseline.",
      ],
      [
        "交付灰度批次表、值守联系树、实时指标清单和扩量决策记录，每次变更注明时间、操作者、覆盖比例及回退核对结果。",
        "Deliver a cohort plan, on-call tree, live metrics and expansion log with time, operator, exposure and rollback checks for each change.",
      ],
      [
        "监控中断、错误率或投诉触及事先批准的停止线时冻结扩量并执行授权回退；没有可用回退开关的批次不得自动扩大。",
        "Freeze expansion and use authorized rollback when monitoring or complaints cross approved stop lines; do not auto-expand without rollback.",
      ],
    ),
    detail(
      [
        "收集定位研究、客户访谈、实际功能证据、价格与可用区域、渠道排期、广告素材授权、销售培训稿及各项审批编号。",
        "Collect positioning research, interviews, capability evidence, price and availability, channel dates, asset rights, sales training and approvals.",
      ],
      [
        "把每项对外卖点连接到用户任务和可核查证据，按渠道选择发布时间与行动入口，同时标注适用客户和不适用场景。",
        "Link each claim to a user task and evidence, choosing channel timing and actions while stating eligible customers and exclusions.",
      ],
      [
        "制作发布信息矩阵、分渠道内容日历、卖点证据表和销售问答稿，记录素材所有者、核准版本、发布日期及纠错联系人。",
        "Create a channel message matrix, content calendar, claim-evidence table and sales FAQ with asset owners, approved versions and correction contacts.",
      ],
      [
        "未核实的性能对比、未获授权的图片或尚未对外的价格不得发布；任何绝对化承诺都须有产品和法务责任人书面确认。",
        "Do not publish unverified comparisons, unauthorized images or unreleased prices; written product and legal approval is required for absolute claims.",
      ],
    ),
    detail(
      [
        "收集目标地区客户规模来源、当地语言校对稿、法规与行业限制、支付和数据存储条件、合作方能力及售后覆盖记录。",
        "Collect sourced regional demand, reviewed translations, legal limits, payment and data residency conditions, partners and support coverage.",
      ],
      [
        "逐地区评估功能可用性、语言适配和服务能力，比较本地试点、合作进入与暂不开放，并计算必须补齐的依赖成本。",
        "Assess availability, localization and service by region; compare pilot, partner entry and delay, including prerequisite costs.",
      ],
      [
        "输出区域就绪矩阵、翻译核验清单、准入依赖路线图和本地支持安排，逐项标明证据日期、负责人、审批状态及开放决定。",
        "Deliver a regional readiness matrix, translation checks, entry roadmap and support plan with evidence dates, owners and launch decisions.",
      ],
      [
        "法规解释、数据驻留或语言风险未经具备职责的人员核验时不得开放该地区；不可服务的支付或支持场景须显式排除。",
        "Do not open regions before qualified review of legal, residency and language risks; explicitly exclude unsupported payment or support cases.",
      ],
    ),
    detail(
      [
        "收集已签署的合作范围、双方版本计划、联合能力验证、商标许可、客户案例书面授权、市场联系人及公告审批流程。",
        "Collect signed scope, both release plans, verified joint capabilities, trademark rights, case permissions, contacts and approval flow.",
      ],
      [
        "将联合方案拆成各方实际负责的产品、支持和沟通动作，对齐版本依赖与公告时间，区分已交付能力和待共同验证部分。",
        "Map each party's product, support and communication duties to version dependencies and dates, separating proven from unverified capability.",
      ],
      [
        "交付联合发布责任矩阵、接口验收表、双方公告排期和客户支持升级路径，记录签署文件、联络人替补及审批完成状态。",
        "Deliver a joint RACI, interface acceptance table, announcement schedule and support escalation path with signed records and backups.",
      ],
      [
        "没有书面品牌许可、双方版本不兼容或客户数据共享范围未签署时不得联合发布，单方口头承诺不能代替授权记录。",
        "Do not co-launch without written brand rights, compatible releases and signed data-sharing scope; verbal claims do not grant authorization.",
      ],
    ),
    detail(
      [
        "收集现售产品目录、版本和套餐关系、客户行业与规模分层、销售访谈、功能可用状态及经核准的对外价格资料。",
        "Collect current product and plan catalog, version dependencies, customer segments, sales interviews, availability and approved pricing.",
      ],
      [
        "按不同客户任务构建选型路径，比较组合购买、独立购买和迁移的实际差异，解释适用条件而非只按产品线排列功能。",
        "Build selection paths by customer task, comparing bundles, standalone purchase and migration by fit rather than feature lists.",
      ],
      [
        "输出组合关系图、客户选型表、套餐差异矩阵及销售讲解页，每项标记当前可订购状态、服务边界和核验日期。",
        "Produce a portfolio map, customer selector, plan matrix and sales guide labeling orderability, service boundaries and verification dates.",
      ],
      [
        "计划功能不可标为现售权益，套餐价格、容量或支持等级冲突时以已批准合同资料为准并暂停生成报价版本。",
        "Do not list planned features as current entitlements; resolve price, capacity or support conflicts against approved contracts before quoting.",
      ],
    ),
    detail(
      [
        "收集拟停用功能的使用日志口径、活跃客户与依赖接口、替代功能差距、兼容期限、通知记录及个案支持联系人。",
        "Collect usage definitions, active customers and interfaces, replacement gaps, compatibility window, notices and support contacts for retirement.",
      ],
      [
        "按依赖和实际使用量识别受影响群体，比较继续维护、限期并行和退役方案，验证替代任务能否完成及迁移需要多少时间。",
        "Identify affected groups by dependency and use; compare maintenance, coexistence and retirement, testing task coverage and migration effort.",
      ],
      [
        "交付退役影响清单、客户通知时间表、迁移步骤卡和例外申请台账，记录客户负责人、替代方案验证、截止日和未迁移原因。",
        "Deliver a retirement impact register, notice schedule, migration cards and exception log with owners, validated alternatives and reasons open.",
      ],
      [
        "关键客户没有可行替代、接口消费者未确认或约定兼容期未满时不得停服；已通知不等于迁移完成，须逐户验证。",
        "Do not retire without viable alternatives for critical customers, confirmed interface consumers or an expired compatibility period; verify each migration.",
      ],
    ),
    detail(
      [
        "收集旧服务合同、拟替换服务能力、数据导出格式、迁移批次、服务时间、客户联系人和双方已承诺的通知期限。",
        "Collect old service contracts, replacement capabilities, export formats, migration cohorts, service hours, contacts and notice commitments.",
      ],
      [
        "按客户分组比较并行服务、切换和暂缓的连续性影响，设计数据对账与回退节点，并明确新旧服务团队的职责交接。",
        "Compare coexistence, cutover and delay by customer continuity; design data reconciliation, rollback and team handoffs.",
      ],
      [
        "形成服务转换计划、客户批次清单、数据交接签收表和切换日值守表，逐项记录原服务终止日、验证人及争议处理入口。",
        "Create a transition plan, customer cohorts, data sign-off and cutover roster with end dates, verifiers and dispute channels.",
      ],
      [
        "新服务未通过验收、数据无法完整导出或合同通知期未满足时不得结束旧服务；紧急人工处理须有授权和期限。",
        "Do not end the old service before acceptance, complete export and contractual notice; temporary manual handling needs approval and expiry.",
      ],
    ),
    detail(
      [
        "收集现行默认值、拟调整参数、产品版本分布、配置覆盖情况、客户反馈、风险评估及恢复旧值的操作说明。",
        "Collect current defaults, proposed settings, version distribution, overrides, customer feedback, risk assessment and restoration steps.",
      ],
      [
        "计算变更影响的用户和工作流，比较全量切换、逐步提示与保留旧值选项，说明用户是否能自行选择及切换后如何验证。",
        "Estimate affected users and workflows; compare full change, staged prompts and opt-in, with user choice and post-change checks.",
      ],
      [
        "交付默认值前后对照表、受影响版本清单、分阶段生效日历和用户恢复指南，标明变更负责人、配置来源和反馈汇总窗口。",
        "Deliver a before/after table, affected versions, rollout calendar and restoration guide with owner, configuration source and feedback window.",
      ],
      [
        "隐私、安全或兼容设置会被削弱时需重新审批；未验证回滚、用户无法恢复旧行为或覆盖优先级冲突时不得广泛生效。",
        "Reapprove changes that weaken privacy, security or compatibility; do not broadly apply without rollback and clear override precedence.",
      ],
    ),
    detail(
      [
        "收集客户环境版本、安装权限、数据量、定制接口、维护窗口、联系人、过往升级记录和针对该环境的兼容验证结果。",
        "Collect customer versions, installation rights, data volume, custom interfaces, maintenance windows, contacts, upgrade history and compatibility tests.",
      ],
      [
        "按环境风险和准备度排序批次，逐户核对备份、预检查、迁移后业务任务及验收时间，保留延期客户的单独支持路径。",
        "Sequence cohorts by readiness and risk, validating backups, prechecks, post-migration tasks and acceptance while supporting deferrals.",
      ],
      [
        "输出客户升级台账、批次沟通日历、环境核验单和失败处理流程，记录版本、实施人与客户验收结果及未解决问题的责任日期。",
        "Deliver an upgrade register, communication calendar, environment checklist and failure process with versions, implementers and acceptance.",
      ],
      [
        "未确认客户授权、备份完整性或回退窗口时不得排入强制批次；定制环境若超出测试矩阵须先进行单独兼容评估。",
        "Do not schedule forced upgrades without customer authorization, verified backups and rollback window; separately assess custom environments.",
      ],
    ),
  ],
  "training-deck": [
    detail(
      [
        "收集岗位入职清单、首日账户申请、基础流程、学习者已有经验、导师安排、练习环境和首周必须独立完成的任务。",
        "Collect the role onboarding list, first-day access requests, basic processes, learner experience, mentors, practice environment and first-week tasks.",
      ],
      [
        "按首日、跟练和独立完成三个阶段安排演示与练习，把每项概念连接到真实工作动作，并说明遇到阻塞时如何求助。",
        "Sequence demonstration, guided practice and independent work, linking each concept to real actions and showing how to ask for help.",
      ],
      [
        "交付入职课件、首周任务卡、演示脚本和观察记录表，列明账户状态、练习证据、导师确认点与需要补课的内容。",
        "Deliver onboarding slides, first-week task cards, demo scripts and observation forms with access status, evidence, mentor checks and make-up work.",
      ],
      [
        "账号权限未开通、练习环境与生产环境差异未说明或学员无法完成关键任务时不得标记培训完成，应保留未决支持事项。",
        "Do not mark training complete when access is missing, environments differ without explanation or key tasks fail; retain open support items.",
      ],
    ),
    detail(
      [
        "收集岗位职责、能力标准、常见工作样本、现有错误类型、学习者基础差异、可用工具及评估负责人和时限。",
        "Collect role duties, competency standards, work samples, error types, learner differences, tools and assessment owners and timing.",
      ],
      [
        "从岗位最关键的任务拆成示范、拆步练习、独立演练和复盘四段，按难度递进设置反馈点，避免只讲术语不练操作。",
        "Break critical tasks into demonstration, guided steps, independent practice and review, increasing difficulty with feedback instead of theory alone.",
      ],
      [
        "输出任务练习包、评分量表、示例答案和补强路径，每项注明适用岗位、通过条件、评估证据、复训日期和责任导师。",
        "Produce practice packs, scoring rubrics, answer examples and remediation paths with role, pass criteria, evidence, retraining date and mentor.",
      ],
      [
        "练习素材脱离岗位或评分标准未获岗位负责人确认时不得用于结业判断；低分应触发针对任务的补练，不用性格标签替代证据。",
        "Do not use exercises for completion when they lack role fit or approved criteria; low scores trigger task practice, not personality labels.",
      ],
    ),
    detail(
      [
        "收集当前流程图、输入输出字段、角色职责、审批与交接记录、近期变更、异常样本、流程负责人的确认记录和制度生效版本。",
        "Collect current process maps, input/output fields, role duties, approvals, handoffs, recent changes, exception samples, owner confirmation and effective policy version.",
      ],
      [
        "用一笔完整案例从触发到关闭展示正常路径、交接点和异常处理，比较责任人、输入质量与等待时间，明确何时升级。",
        "Use one complete case to show normal flow, handoffs and exceptions, comparing owners, input quality and wait time and defining escalation.",
      ],
      [
        "交付流程地图、逐步讲义、异常决策表和演练记录，标明当前版本、生效日期、每个交接的验收信号及求助窗口。",
        "Deliver a process map, step guide, exception decision table and exercise record with version, effective date, handoff signals and help path.",
      ],
      [
        "流程版本过期、职责边界无人确认或异常处理依赖未公开权限时暂停授课，不能把历史惯例当作现行制度。",
        "Pause instruction when the process is obsolete, ownership is unconfirmed or exceptions require undisclosed access; do not teach history as policy.",
      ],
    ),
    detail(
      [
        "收集工具截图、练习账号、角色权限、沙盒数据、常见错误、支持入口、版本差异和禁止展示的真实凭据范围。",
        "Collect tool screenshots, practice accounts, role permissions, sandbox data, common errors, support channels, version differences and credential restrictions.",
      ],
      [
        "按准备、登录、核心操作、校验和撤销顺序编排上手任务，用截图说明关键状态并让学员在脱敏环境中复现一次。",
        "Sequence setup, login, core action, verification and undo; use screenshots for key states and have learners reproduce it in sanitized data.",
      ],
      [
        "交付工具操作课件、沙盒任务清单、错误排查卡和反馈表，标明截图版本、权限边界、成功证据及无法继续时的联系人。",
        "Deliver tool slides, sandbox tasks, troubleshooting cards and feedback forms with screenshot version, permission limits, success evidence and contact.",
      ],
      [
        "真实账号、令牌、客户数据或生产写操作不得出现在课件和练习中；权限不足时明确申请路径，不以共享凭据绕过控制。",
        "Never include real accounts, tokens, customer data or production writes; show the request path rather than bypassing controls with shared credentials.",
      ],
    ),
    detail(
      [
        "收集服务标准、脱敏客户场景、历史反馈、响应等级、可承诺范围、典型的未解决问题记录、升级联系人和角色扮演评价人。",
        "Collect service standards, sanitized customer scenarios, historical feedback, response levels, promise boundaries, unresolved case examples and role-play assessors.",
      ],
      [
        "围绕倾听、澄清、回应、记录和升级设计逐步对话，先演示符合标准的版本，再让学员处理信息不全和情绪升级情境。",
        "Design dialogue practice for listening, clarification, response, logging and escalation, including incomplete information and escalation scenarios.",
      ],
      [
        "输出服务话术示例、角色卡、评分表和复盘记录，列出事实确认项、不可承诺事项、响应时限及交接责任。",
        "Deliver service examples, role cards, scoring forms and review records with fact checks, forbidden promises, response times and handoff owners.",
      ],
      [
        "未经核实的客户评价不得当作事实；学员超出授权承诺、泄露客户资料或跳过升级时，应记录具体行为并安排复练。",
        "Do not treat unverified customer opinions as facts; record concrete over-promising, disclosure or skipped escalation and retrain.",
      ],
    ),
    detail(
      [
        "收集适用安全制度、设备说明、作业区域限制、风险评估、事故教训、停止作业权限、应急联系人及合格讲师资质。",
        "Collect applicable safety policy, equipment instructions, area limits, risk assessments, incident lessons, stop-work authority, emergency contacts and qualified trainer.",
      ],
      [
        "按照危险识别、开工前检查、作业中监测、停止条件和事故升级编排课程，使用真实但脱敏的教训解释为何不能跳步。",
        "Sequence hazard recognition, pre-start checks, monitoring, stop conditions and incident escalation, using sanitized lessons to explain why steps matter.",
      ],
      [
        "交付安全课件、设备检查清单、停止作业决策卡和应急演练记录，注明制度版本、责任主管、集合点和复训周期。",
        "Deliver safety slides, equipment checklist, stop-work card and emergency drill record with policy version, supervisor, muster point and retraining cycle.",
      ],
      [
        "安全要求未由合格负责人确认、设备状态异常或现场条件超出风险评估时不得开工；培训展示不等于取得作业授权。",
        "Do not start when a qualified owner has not confirmed requirements, equipment is abnormal or conditions exceed the assessment; training is not work authorization.",
      ],
    ),
    detail(
      [
        "收集质量标准版本、抽检记录、缺陷样本、判定规则、批次信息、测量设备校准记录、复核岗位和不合格处置流程，注明样本时间范围。",
        "Collect quality-standard versions, inspection records, defect samples, decision rules, batch data, instrument calibration, reviewers and nonconformance handling with sample dates.",
      ],
      [
        "让学员先独立判定再对照标准答案，讨论边界样本、记录字段和发现缺陷后的隔离与升级动作，区分观察与推测。",
        "Have learners judge independently before comparing standards, discussing borderline samples, recording fields and isolation and escalation.",
      ],
      [
        "输出判定练习集、答案依据表、缺陷记录模板和升级流程图，每项标出标准版本、证据照片、判定人及复核截止日。",
        "Deliver a judgment exercise set, rationale table, defect form and escalation map with standard version, evidence, judge and review deadline.",
      ],
      [
        "样本不代表当前批次、判定标准已更新或缺陷照片不足时不得据此宣布达标；抽样通过不等于整批无缺陷。",
        "Do not declare competence when samples are unrepresentative, criteria changed or evidence is incomplete; passing a sample does not clear a batch.",
      ],
    ),
    detail(
      [
        "收集沟通原则、客户问题样本、服务边界、授权矩阵、可用知识库、升级路径和需要保护的客户信息类别。",
        "Collect communication principles, customer question samples, service boundaries, authority matrix, knowledge base, escalation path and protected data categories.",
      ],
      [
        "设计从复述问题、澄清事实、给出可验证回应到记录后续的角色练习，覆盖信息缺失、冲突要求和需要跨团队处理的场景。",
        "Design role practice from restating and clarifying to verifiable response and follow-up logging, including missing information and conflicts.",
      ],
      [
        "交付沟通流程图、问题角色卡、授权边界清单和评估表，记录回应依据、客户确认、升级对象、时限及未解决事项。",
        "Deliver a communication flow, role cards, authority checklist and assessment form with evidence, customer confirmation, escalation, timing and open items.",
      ],
      [
        "学员不得承诺未授权的价格、交期或结果，也不得在练习中展示可识别客户信息；疑难请求需按渠道升级并保留记录。",
        "Learners must not promise unauthorized prices, dates or outcomes or expose identifiable customer data; difficult requests follow the recorded escalation path.",
      ],
    ),
    detail(
      [
        "收集管理职责说明、团队目标、授权范围、反馈记录、典型人员场景、有关决策的上下文资料、会议材料和可观察行为标准。",
        "Collect management duties, team objectives, authority boundaries, feedback records, management scenarios, decision context, meeting materials and observable behavior standards.",
      ],
      [
        "用授权分配、目标对齐、反馈对话和取舍决策四类场景练习管理职责，要求学员说出依据、风险和后续复盘办法。",
        "Practice management duties through delegation, alignment, feedback and tradeoff scenarios, requiring rationale, risks and review steps.",
      ],
      [
        "输出管理情景卡、决策记录模板、反馈观察表和复盘问题清单，标出授权人、影响对象、行动期限及行为证据。",
        "Deliver management scenario cards, decision logs, observation forms and review questions with approvers, affected parties, deadlines and evidence.",
      ],
      [
        "评价必须基于可观察行为和实际结果，不用性格印象作结论；涉及人员隐私的反馈只向有职责的评估人开放。",
        "Assess observable behavior and outcomes rather than personality impressions; restrict personnel feedback to authorized assessors.",
      ],
    ),
    detail(
      [
        "收集跨团队流程、角色清单、输入输出约定、常见阻塞、依赖时限、双方确认的交付标准、升级联系人和近期协作案例。",
        "Collect cross-team workflows, role lists, input/output agreements, common blockers, dependency timing, jointly confirmed delivery standards, escalation contacts and recent cases.",
      ],
      [
        "围绕需求对齐、交接确认、依赖延期和冲突处理安排模拟会议，要求参与者记录决定、未决事项和下一次同步时间。",
        "Run simulations for alignment, handoff confirmation, delayed dependencies and conflict, recording decisions, open items and next sync.",
      ],
      [
        "交付协作流程图、会议议程模板、交接清单和升级台账，注明每个接口的负责团队、输入质量、响应时限及证据位置。",
        "Deliver a collaboration map, agenda template, handoff checklist and escalation register with owners, input quality, response times and evidence.",
      ],
      [
        "职责边界冲突、交接无人接收或升级渠道未确认时不得把练习标为通过；应保留争议内容并交由实际负责人决定。",
        "Do not pass practice when ownership conflicts, handoffs lack recipients or escalation is unconfirmed; preserve the dispute for the actual owner.",
      ],
    ),
    detail(
      [
        "收集反馈方法、观察记录模板、辅导目标、岗位行为标准、双方约定的支持资源、被辅导者授权范围和后续检查日期。",
        "Collect feedback methods, observation forms, coaching goals, role behavior standards, agreed support resources, coachee authorization and follow-up dates.",
      ],
      [
        "练习用具体事实描述行为、邀请对方补充背景、共同约定行动和检查点，区分当下辅导、正式评价与纪律流程。",
        "Practice factual behavior descriptions, inviting context, agreeing actions and checkpoints, distinguishing coaching from formal evaluation or discipline.",
      ],
      [
        "交付辅导对话脚本、观察记录表、行动协议和复盘日历，记录行为证据、双方约定、支持资源、期限和完成验证人。",
        "Deliver coaching scripts, observation forms, action agreements and review calendar with evidence, commitments, resources, deadlines and verifier.",
      ],
      [
        "不得在课件或案例中暴露可识别人员的敏感评价；没有观察事实时不能推断动机，辅导记录应按授权保存和访问。",
        "Do not expose identifiable sensitive evaluations; do not infer motives without observations, and store coaching records under authorized access.",
      ],
    ),
    detail(
      [
        "收集典型问题、历史数据、现有诊断记录、可调用工具、解决过程、行动结果及问题负责人的复盘安排。",
        "Collect typical problems, historical data, diagnostic records, available tools, prior resolutions, outcomes and owner review arrangements.",
      ],
      [
        "让学员先界定现象、影响和成功标准，再提出可证伪原因，按证据优先级比较方案并设计小范围验证和后续测量。",
        "Have learners define symptoms, impact and success criteria, propose falsifiable causes, compare options by evidence and design a bounded test.",
      ],
      [
        "输出问题定义表、证据与假设矩阵、方案比较表和验证行动卡，注明数据来源、负责人、预期信号、截止日及复盘结论。",
        "Deliver problem-definition, evidence-hypothesis matrix, option comparison and validation cards with sources, owners, signals, dates and conclusions.",
      ],
      [
        "数据缺失或观察结果与假设冲突时保留未知，不得用相关性直接认定根因；行动效果需复测并记录是否达到成功标准。",
        "Retain unknowns when data is missing or observations conflict; correlation is not a root cause, and actions require remeasurement against success criteria.",
      ],
    ),
  ],
  "project-kickoff": [
    detail(
      [
        "收集项目授权书、需求基线、发起人和关键干系人名单、初步预算、资源承诺、预期交付及已知外部依赖，并核对授权范围和预算确认记录的版本与日期。",
        "Collect the charter, requirements baseline, sponsor and stakeholder list, initial budget, resource commitments, deliverables and known dependencies; verify the versions and dates of the authority scope and budget confirmation.",
      ],
      [
        "把目标、范围、阶段交付、决策权限和成功标准拆成可核对的开场共识，明确哪些事项仍需发起人作出决定。",
        "Turn objectives, scope, phase deliverables, decision rights and success criteria into checkable kickoff agreements, naming sponsor decisions still open.",
      ],
      [
        "交付项目启动简报、目标与范围表、角色责任矩阵、首阶段时间线和开放问题台账，注明确认人、日期与下一步。",
        "Deliver a kickoff brief, scope table, RACI, first-phase timeline and open-issue register with confirmers, dates and next steps.",
      ],
      [
        "授权、预算或成功标准未得到发起人确认时不得宣布正式启动；口头愿望不能替代书面范围和责任承诺。",
        "Do not declare a formal start without sponsor confirmation of authority, budget and success criteria; informal wishes do not replace written scope.",
      ],
    ),
    detail(
      [
        "收集一期结项报告、已验收交付物、未关闭缺陷、遗留合同、二期目标、现有团队安排和跨期技术及数据依赖。",
        "Collect phase-one closure, accepted deliverables, open defects, legacy contracts, phase-two goals, team plans and cross-phase dependencies.",
      ],
      [
        "将继承内容、变更内容和全新内容分层，比较一期决策对二期范围、预算、时间和验收标准的影响，避免把遗留事项隐藏。",
        "Separate carryover, changed and new work, comparing phase-one decisions' impact on phase-two scope, budget, timing and acceptance.",
      ],
      [
        "输出一二期边界对照表、遗留事项责任台账、二期里程碑图和交接会议清单，记录验收证据、负责人及关闭条件。",
        "Produce a phase boundary comparison, carryover register, phase-two milestones and handoff agenda with evidence, owners and closure conditions.",
      ],
      [
        "一期未验收、遗留风险无人接收或二期预算尚未批准时不得把二期承诺写成既定计划，需保留依赖和暂缓选项。",
        "Do not present phase two as committed when phase one lacks acceptance, risks lack owners or its budget is unapproved; retain dependencies and deferral.",
      ],
    ),
    detail(
      [
        "收集内部问题清单、流程基线、处理时长、错误率、用户反馈、改善目标、试点资源和现行制度限制，同时取得基线统计周期、样本量和缺失记录。",
        "Collect internal issues, process baseline, handling time, error rate, user feedback, improvement goals, pilot resources and policy constraints, including the baseline period, sample size and missing records.",
      ],
      [
        "先定义现状口径和主要瓶颈，再安排小范围诊断、试点改进和复测，把短期修复与需要长期投资的结构问题分开。",
        "Define the current measure and bottlenecks first, then plan bounded diagnosis, pilot improvement and remeasurement, separating quick fixes from structural work.",
      ],
      [
        "交付现状基线页、问题优先级表、试点计划、指标定义和持续改进节奏，列出数据来源、责任人、样本区间及复盘日期。",
        "Deliver a baseline, issue priorities, pilot plan, metric definitions and improvement cadence with sources, owners, sample window and review date.",
      ],
      [
        "基线数据不一致、试点改变了测量方法或改善目标未获业务负责人确认时不得宣称效果，应先补齐口径和复测安排。",
        "Do not claim improvement when baselines conflict, the pilot changes measurement or owners have not confirmed goals; repair definitions and remeasure.",
      ],
    ),
    detail(
      [
        "收集研究问题、伦理审批状态、方法草案、样本来源、数据字段、知情同意材料、分析资源及拟作决定的时间节点，并核对样本选择标准和资料保存期限。",
        "Collect the research question, ethics status, method draft, sample source, data fields, consent materials, analysis resources and decision dates; verify sampling criteria and information-retention periods.",
      ],
      [
        "按研究问题拆分招募、采集、清洗、分析和评审步骤，明确每阶段的样本门槛、停止条件、偏差检查与决策接口。",
        "Break recruitment, collection, cleaning, analysis and review into steps with sample gates, stop conditions, bias checks and decision interfaces.",
      ],
      [
        "交付研究启动书、方法与数据字典、样本时间线、伦理待办表和阶段评审模板，记录数据保管人、限制与成果归属。",
        "Deliver a research brief, method and data dictionary, sample timeline, ethics tracker and stage-review template with custodians, limits and ownership.",
      ],
      [
        "伦理批准、参与者同意或隐私边界未确认时不得采集数据；样本不足或方法变更必须记录并重新评估结论可信度。",
        "Do not collect data before ethics, consent and privacy boundaries are confirmed; record sample limits or method changes and reassess confidence.",
      ],
    ),
    detail(
      [
        "收集参与部门、各自目标、职责草案、接口清单、共享资源、会议节奏、冲突事项和已确认的升级联系人，补充各部门资源承诺记录和接口交付条件。",
        "Collect participating departments, goals, draft duties, interfaces, shared resources, meeting cadence, conflicts and escalation contacts, plus departmental resource commitments and interface handoff conditions.",
      ],
      [
        "把跨部门工作拆成输入、产出、验收和升级路径，比较重复职责与空缺接口，并约定决定如何记录、何时升级和谁有最终权。",
        "Break cross-department work into inputs, outputs, acceptance and escalation, exposing duplicate or missing ownership and final decision rights.",
      ],
      [
        "输出跨部门流程图、责任矩阵、依赖清单、会议议程和升级规则，逐项注明接口负责人、响应时限和冲突复核日期。",
        "Deliver a cross-department flow, RACI, dependency list, agenda and escalation rules with interface owners, response times and review dates.",
      ],
      [
        "角色重叠、共享资源未承诺或升级人无权限时不得标记接口已就绪；争议需保留原记录并由有权人裁决。",
        "Do not mark interfaces ready when roles overlap, shared resources are uncommitted or escalation lacks authority; retain disputes for authorized decision.",
      ],
    ),
    detail(
      [
        "收集系统接口清单、数据字典、测试环境、凭据申请、上下游负责人、样例数据、联调窗口和已知兼容限制，并取得接口版本、字段映射及回退方案。",
        "Collect interfaces, data dictionary, test environments, access requests, owners, sample data, integration windows and compatibility limits, plus interface versions, field mappings and rollback plans.",
      ],
      [
        "按接口依赖安排设计确认、开发联调、端到端测试和验收，明确字段映射、错误重试、幂等要求及异常回退顺序。",
        "Sequence design confirmation, integration, end-to-end tests and acceptance by dependency, defining mappings, retries, idempotency and rollback.",
      ],
      [
        "交付集成计划、接口责任表、测试场景矩阵和联调问题台账，注明权限状态、样例来源、预计完成日及失败处置人。",
        "Deliver an integration plan, interface RACI, test matrix and issue register with access, sample sources, dates and failure owners.",
      ],
      [
        "接口权限、数据契约或兼容版本未确认时不得进入生产联调；没有可回退的测试数据处理不得标记集成可恢复。",
        "Do not enter production integration before access, contracts and compatibility are confirmed; test-data handling without rollback is not recoverable.",
      ],
    ),
    detail(
      [
        "收集现行流程、拟变更步骤、受影响岗位、业务高峰、培训资源、试运行窗口、例外情形和连续性要求，并核对旧流程版本、关键岗位培训记录和回退窗口。",
        "Collect the current process, proposed steps, affected roles, peak periods, training resources, trial window, exceptions and continuity needs; verify the old-process version, critical-role training records and rollback window.",
      ],
      [
        "将设计、培训、试运行和正式切换排成阶段，比较全量切换与并行运行的风险，明确异常回到旧流程的触发条件。",
        "Phase design, training, trial and cutover, comparing full switch with coexistence and defining triggers to return to the old process.",
      ],
      [
        "输出流程变更图、角色培训表、试运行日历、业务连续性清单和切换决策页，记录版本、生效负责人及复盘节点。",
        "Deliver a process-change map, training matrix, trial calendar, continuity checklist and cutover decision with version, owner and review point.",
      ],
      [
        "培训未覆盖关键岗位、例外处理未演练或高峰期无法维持服务时不得切换；应保留回退窗口和人工接管责任。",
        "Do not cut over when critical roles lack training, exceptions are untested or service cannot continue at peak; retain rollback and manual owners.",
      ],
    ),
    detail(
      [
        "收集合同签署版本、交付边界、双方联系人、联合里程碑、沟通渠道、验收条款、争议升级方式和变更申请模板。",
        "Collect signed contracts, delivery boundaries, contacts, joint milestones, communication channels, acceptance terms, dispute escalation and change template.",
      ],
      [
        "把合同承诺映射到联合计划，明确客户、供应商和内部团队的交付输入与验收证据，安排定期检查和争议升级时限。",
        "Map contract commitments to the joint plan, defining inputs and acceptance evidence for client, supplier and internal teams with review and escalation timing.",
      ],
      [
        "交付联合里程碑表、验收证据清单、沟通日历和争议台账，注明合同条款、责任人、预计日期、变更审批及未决影响。",
        "Deliver a joint milestone table, acceptance evidence list, communication calendar and dispute register with clauses, owners, dates and change approvals.",
      ],
      [
        "口头承诺与签署文件冲突时以合同为准；未签字范围、责任和交付日期不得进入对外承诺或计入已确认计划。",
        "Use the signed contract when verbal promises conflict; unsigned scope, duties or dates are not external commitments or confirmed plan items.",
      ],
    ),
    detail(
      [
        "收集客户需求纪要、实施前置条件、数据准备清单、环境和账号要求、验收标准、客户联系人及双方可用窗口，并核对合同范围和客户测试环境准备记录。",
        "Collect customer requirements, prerequisites, data-preparation list, environment and access needs, acceptance criteria, contacts and available windows; verify contract scope and customer test-environment readiness records.",
      ],
      [
        "把客户与实施团队任务按阶段拆分，核对数据准备、配置、培训、测试和验收的依赖，明确客户迟延如何影响里程碑。",
        "Break customer and delivery tasks by phase, checking data, configuration, training, testing and acceptance dependencies and delay impact.",
      ],
      [
        "输出客户责任矩阵、实施时间线、准备度检查单和验收会议模板，列出范围确认人、窗口、证据格式及未准备项的处理。",
        "Deliver a customer RACI, implementation timeline, readiness checklist and acceptance template with scope owners, windows, evidence format and gaps.",
      ],
      [
        "客户数据、审批或测试环境未准备时不得承诺原定日期；范围外请求应单列并走变更审批，不能悄悄吸收。",
        "Do not promise the original date without customer data, approvals and test environment; out-of-scope requests require change approval.",
      ],
    ),
    detail(
      [
        "收集采购结果、供应商资质、服务级别、访问申请、交付联系人、接入环境、数据使用条款和退出及移交要求，核实资质有效期与拟访问系统和数据范围。",
        "Collect procurement results, supplier qualifications, service levels, access requests, delivery contacts, environments, data terms and exit requirements; verify qualification expiry and the proposed systems and data to be accessed.",
      ],
      [
        "按接入、试运行、交付、服务复核和退出五段安排供应商启动，核对权限最小化、联络替补、指标采集和问题升级。",
        "Plan supplier onboarding through access, trial, delivery, service review and exit, checking least privilege, backups, metrics and escalation.",
      ],
      [
        "交付供应商启动包、账号与权限清单、服务指标表、交付验收点和退出交接清单，注明合同依据、负责人及复核周期。",
        "Deliver a supplier kickoff pack, access list, service metrics, acceptance points and exit handoff with contract basis, owners and review cadence.",
      ],
      [
        "资质未核验、访问授权超范围或数据用途不清时不得接入；退出路径未验证不得把供应商依赖标为可控。",
        "Do not grant access before qualifications, scope and data use are verified; an untested exit path is not a controlled dependency.",
      ],
    ),
    detail(
      [
        "收集外包合同、工作范围、交付物模板、阶段验收、知识产权、保密要求、交接清单、服务窗口和沟通责任人，补充各阶段质量标准及知识移交成果清单。",
        "Collect outsourcing contract, scope, deliverable templates, stage acceptance, IP, confidentiality, handoff list, service windows and contacts, plus phase quality standards and knowledge-transfer deliverables.",
      ],
      [
        "按阶段建立交付、评审、返工和验收节奏，比较质量证据与进度信号，明确何时升级未交付、变更或知识转移缺口。",
        "Set delivery, review, rework and acceptance cadence by phase, comparing quality and schedule signals and defining escalation for gaps.",
      ],
      [
        "输出外包交付台账、质量抽查表、阶段结算条件和知识交接计划，记录版本、验收人、缺陷修复期限及知识产权状态。",
        "Deliver an outsourced-delivery register, quality sampling, payment gates and knowledge-transfer plan with versions, approvers, fix deadlines and IP status.",
      ],
      [
        "未满足合同验收、关键知识未移交或保密条款未确认时不得结算或结束阶段；遗留缺陷须保留责任和复验日期。",
        "Do not pay or close a phase before contract acceptance, key knowledge transfer and confidentiality checks; retain defect owners and retest dates.",
      ],
    ),
    detail(
      [
        "收集试点目标、参与单位、样本规模、周期、资源、基线指标、观察责任人、成功门槛和不扩展时的替代安排，同时记录样本选取方法及数据使用授权范围。",
        "Collect pilot goals, participants, sample, duration, resources, baseline metrics, observers, success gates and the alternative if not expanded, recording sampling methods and authorized data-use scope.",
      ],
      [
        "将试点分为准备、运行、观察和复盘，明确每周指标和反馈渠道，比较扩展、延长、调整与停止的决策依据。",
        "Divide the pilot into preparation, operation, observation and review, defining weekly metrics and feedback channels and comparing next choices.",
      ],
      [
        "交付试点章程、参与者名单、指标看板、问题台账和复盘决议页，记录样本偏差、投入成本、证据链接和后续负责人。",
        "Deliver a pilot charter, participant list, metric board, issue log and review decision with bias, cost, evidence links and next owners.",
      ],
      [
        "成功门槛未达到、样本偏差无法解释或资源消耗超过批准上限时不得自动扩展；停止也要安排数据保全和参与者通知。",
        "Do not auto-expand below gates, with unexplained bias or over-budget resources; stopping still requires data preservation and participant notice.",
      ],
    ),
  ],
  "client-proposal": [
    detail(
      [
        "收集客户问题陈述、访谈纪要、现状证据、已授权案例、目标范围、关键联系人、决策时间和咨询成果形式，并核对客户决策标准、证据时点和案例许可范围。",
        "Collect the client problem, interview notes, current evidence, authorized cases, scope, contacts, decision timing and deliverable format; verify decision criteria, evidence dates and case-permission scope.",
      ],
      [
        "把客户现状、可验证诊断、建议选项和可验收成果分层，明确证据支持的判断与仍需客户确认的假设。",
        "Separate client context, evidence-backed diagnosis, options and acceptable deliverables, labeling assumptions still needing confirmation.",
      ],
      [
        "交付提案概览、问题与证据表、工作范围、阶段产出、客户配合事项和验收方式，注明每项成果的负责人和日期。",
        "Deliver a proposal overview, problem-evidence table, scope, phase outputs, client inputs and acceptance method with owners and dates.",
      ],
      [
        "没有访谈或数据支持的判断应标为假设；未授权案例、未经确认的结果和客户内部信息不得写成既定事实。",
        "Label unsupported judgments as assumptions; do not present unauthorized cases, unconfirmed results or internal client information as facts.",
      ],
    ),
    detail(
      [
        "收集需求清单、现有系统和接口、数据规模、实施资源、客户窗口、迁移约束、测试条件与目标交付日期，补充数据质量记录和客户环境准备状态。",
        "Collect requirements, current systems and interfaces, data volume, implementation resources, client windows, migration constraints, test conditions and target date, plus data-quality records and client environment readiness.",
      ],
      [
        "将配置、迁移、测试、培训和验收拆成阶段，计算每阶段客户依赖及关键路径，区分标准范围、可选项和明确排除项。",
        "Break configuration, migration, testing, training and acceptance into phases, calculating client dependencies and critical path while separating options and exclusions.",
      ],
      [
        "输出实施工作分解、责任矩阵、时间线、验收证据清单和变更流程，列出客户提供物、预计工时、风险负责人及缓冲。",
        "Deliver a work breakdown, RACI, timeline, acceptance evidence and change process with client inputs, effort, risk owner and buffer.",
      ],
      [
        "客户数据、接口权限或测试环境未准备时不得承诺固定日期；范围外的配置与迁移必须单列并重新报价或审批。",
        "Do not promise fixed dates without client data, access and test environment; out-of-scope configuration and migration require separate approval.",
      ],
    ),
    detail(
      [
        "收集当前服务目录、工单量、峰值时段、响应与解决记录、服务团队排班、现有问题及客户希望的服务等级，并核对工单统计周期和非工作时段覆盖。",
        "Collect the current service catalog, ticket volume, peak periods, response and resolution records, staffing, open issues and desired service levels; verify the ticket reporting period and after-hours coverage.",
      ],
      [
        "比较不同服务模式的覆盖、响应、升级、报告和成本，说明排班假设、非工作时间边界以及客户必须承担的输入。",
        "Compare service models by coverage, response, escalation, reporting and cost, stating staffing assumptions, after-hours limits and client inputs.",
      ],
      [
        "交付服务方案、等级与指标表、值守与升级路径、报告样例和启动时间线，列出测量口径、例外和复核会议。",
        "Deliver a service model, level and metric table, on-call and escalation path, report sample and launch timeline with definitions and exceptions.",
      ],
      [
        "服务量、排班或响应基线未核实不得保证固定等级；客户数据敏感或跨区域支持存在限制时须明确边界和替代通道。",
        "Do not guarantee fixed levels without verified volume, staffing and baseline; state boundaries and alternatives for sensitive or cross-region support.",
      ],
    ),
    detail(
      [
        "收集学员岗位与基础、学习目标、课时上限、授课方式、练习设备、讲师分工、评估方式及客户希望观察的行为，并核对学员人数与练习环境可用性。",
        "Collect learner roles and baseline, learning goals, hour limit, delivery mode, practice equipment, instructors, evaluation and desired behaviors; verify learner count and practice-environment availability.",
      ],
      [
        "把课程模块、示范、练习、作业和评估按岗位任务排序，比较集中授课与分段学习，说明完成证据和课后支持。",
        "Order modules, demos, practice, assignments and evaluation by job tasks, comparing intensive and spaced delivery with completion evidence and support.",
      ],
      [
        "交付课程地图、课时表、讲师责任、练习材料、评估量表和反馈节奏，列明前置条件、补课安排及资料更新日期。",
        "Deliver a curriculum map, hours, instructor duties, practice materials, rubric and feedback cadence with prerequisites, make-up and update dates.",
      ],
      [
        "不得保证未经验证的业务改善或外部认证；设备、时间或学员基础不足时应调整范围，不把出勤记录当作能力达标。",
        "Do not promise unverified business improvement or external certification; adjust scope for equipment, time or baseline and do not equate attendance with competence.",
      ],
    ),
    detail(
      [
        "收集现有合同版本、已交付服务记录、验收与反馈、未决事项、续约日期、价格条款和双方希望讨论的续约目标。",
        "Collect the current contract, delivered service records, acceptance and feedback, open items, renewal date, price terms and renewal goals.",
      ],
      [
        "先对照合同总结已交付和遗留，再比较续约期限、服务等级、改进承诺与价格选项，明确哪些内容需要重新谈判。",
        "Summarize delivered and open work against the contract, then compare renewal terms, service levels, improvements and price options, flagging renegotiation.",
      ],
      [
        "输出续约成果回顾、服务与反馈对照表、条款选项、改进行动和谈判问题清单，注明证据来源、责任人和决定日期。",
        "Deliver a renewal review, service-feedback table, term options, improvement actions and negotiation questions with evidence, owners and decision date.",
      ],
      [
        "合同义务、客户反馈或价格计算口径未核实不得宣称达成成果；续约建议不能覆盖尚未关闭的违约或服务风险。",
        "Do not claim results without verified obligations, feedback and pricing; renewal recommendations cannot hide unresolved breaches or service risks.",
      ],
    ),
    detail(
      [
        "收集已交付范围、新增需求、客户优先级、额外资源、接口和数据依赖、现有费用与变更审批流程，并取得原验收记录及新增服务量估计。",
        "Collect delivered scope, new needs, priorities, added resources, interfaces and data dependencies, current fees and change process, plus original acceptance records and estimates of added service volume.",
      ],
      [
        "制作扩展前后对照，比较新增工作对服务、费用、交付窗口和双方责任的影响，将可选项与必要前置条件分开。",
        "Compare before and after expansion by service, cost, delivery window and responsibilities, separating options from prerequisites.",
      ],
      [
        "交付范围增量表、资源与费用明细、依赖时间线、验收变更和客户决策页，记录新增项、取消项、负责人及批准状态。",
        "Deliver an incremental scope table, resource and cost detail, dependency timeline, revised acceptance and decision page with approvals.",
      ],
      [
        "新增接口、数据处理或支持等级未获客户确认时不得承诺；原合同边界被改变必须重新签署或记录正式变更。",
        "Do not commit unconfirmed interfaces, data handling or service levels; altered contract boundaries require a signed change.",
      ],
    ),
    detail(
      [
        "收集一期结项与验收、客户反馈、遗留事项、二期需求、可用资源、预算假设、依赖方和客户决策时点，并核对遗留缺陷责任、关闭条件和二期验收草案。",
        "Collect phase-one closure and acceptance, client feedback, carryover, phase-two needs, resources, budget assumptions, dependencies and decision dates; verify carryover defect owners, closure conditions and draft phase-two acceptance.",
      ],
      [
        "把一期遗留、二期新目标和共同依赖分层，比较不同二期范围对里程碑、投入、客户配合和验收的影响。",
        "Separate phase-one carryover, new phase-two goals and shared dependencies, comparing scope options by milestones, effort, client input and acceptance.",
      ],
      [
        "输出二期目标与范围、里程碑和预算表、遗留责任、客户准备度清单及验收边界，列出批准点和延期选项。",
        "Deliver phase-two goals and scope, milestone and budget table, carryover owners, readiness checklist and acceptance boundaries with approval and delay options.",
      ],
      [
        "一期遗留无人负责、二期预算未确认或客户依赖缺少日期时不得把二期时间线写成承诺；验收标准需重新签认。",
        "Do not commit phase-two dates without carryover owners, approved budget and dated client dependencies; re-sign acceptance criteria.",
      ],
    ),
    detail(
      [
        "收集现行服务清单、调整原因、客户影响、合同限制、成本与服务指标、替代方式、迁移资源和沟通要求，并核对客户通知期限与现有服务水平约定。",
        "Collect current services, reason for change, client impact, contract limits, cost and metrics, alternatives, migration resources and communications; verify client notice periods and existing service-level commitments.",
      ],
      [
        "比较保持现状、分阶段调整和立即调整，说明每项对服务连续性、价格、人员、依赖和客户操作的影响及过渡路径。",
        "Compare unchanged, staged and immediate adjustment by continuity, price, people, dependencies and client actions with transition paths.",
      ],
      [
        "交付调整选项矩阵、受影响客户清单、过渡时间线、通知文案和回退条件，记录合同条款、审批人、窗口及支持联系人。",
        "Deliver an adjustment matrix, affected clients, transition timeline, notice copy and rollback conditions with terms, approvers and support contacts.",
      ],
      [
        "合同价格、服务等级或通知期未经确认不得写入承诺；切换期间若服务低于约定标准，应明确补救和升级责任。",
        "Do not promise prices, levels or notice periods without confirmation; define remedy and escalation if service falls below terms during transition.",
      ],
    ),
    detail(
      [
        "收集双方渠道覆盖、目标客群、线索来源、销售流程、数据共享方式、合作条件、品牌许可和联合指标定义，并核对客户联系授权及线索归属记录。",
        "Collect channel coverage, target customers, lead sources, sales process, data sharing, partnership terms, brand rights and joint metrics; verify customer-contact permissions and lead-attribution records.",
      ],
      [
        "按获客、资格、交接、报价和复盘拆分双方动作，比较线索归属和联合投入方案，明确哪些数据可共享及保存多久。",
        "Break both parties' actions into acquisition, qualification, handoff, quote and review, comparing attribution and shared investment with data limits.",
      ],
      [
        "输出渠道分工图、线索交接表、联合活动日历、指标口径和授权清单，列出联系人、响应时限、争议处理及退出方式。",
        "Deliver a channel map, lead handoff, joint calendar, metric definitions and authorization list with contacts, response times, disputes and exit.",
      ],
      [
        "数据共享、客户联系或品牌使用未获书面授权时不得启动联合活动；归因重复时需保留争议并按约定复核。",
        "Do not start joint activity without written data, contact and brand authorization; retain attribution disputes for agreed review.",
      ],
    ),
    detail(
      [
        "收集双方产品与服务能力、目标场景、接口约束、客户需求、交付资源、验证案例和联合支持联系人，并取得接口版本、测试结果和责任分工草案。",
        "Collect both parties' capabilities, target scenarios, interface constraints, client needs, delivery resources, validation cases and support contacts, plus interface versions, test results and draft responsibilities.",
      ],
      [
        "从客户任务倒推联合价值、系统交付架构和责任边界，区分已验证接口、需试验的集成和仅作为愿景的能力。",
        "Derive joint value, delivery architecture and boundaries from client tasks, separating verified interfaces, experiments and vision.",
      ],
      [
        "交付联合方案架构图、能力与需求映射、实施分工、接口验收和风险台账，记录证据链接、负责人、假设及复核节点。",
        "Deliver a joint architecture, capability map, implementation RACI, interface acceptance and risk register with evidence, owners, assumptions and reviews.",
      ],
      [
        "没有可复现的集成验证或双方责任未确认时不得宣传已打通；客户数据和接口权限须按最小范围单独审批。",
        "Do not advertise integration as complete without reproducible verification and confirmed responsibilities; approve data and access minimally.",
      ],
    ),
    detail(
      [
        "收集试点对象画像、目标任务、样本规模、周期、资源、费用承担、成功标准、反馈渠道和扩展决策时间，并核对样本选取方式、基线数据、退出责任及数据使用许可。",
        "Collect pilot profile, target tasks, sample, duration, resources, fee ownership, success criteria, feedback channel and expansion date; verify sampling, baseline data, exit responsibilities and data-use permission.",
      ],
      [
        "提出受限范围和阶段投入，安排基线、运行、评估与退出，比较扩展、延长、调整或停止的条件及双方责任。",
        "Propose limited scope and staged investment with baseline, operation, evaluation and exit, comparing expansion, extension, adjustment or stop.",
      ],
      [
        "输出试点提案、样本和任务表、指标看板、费用与责任表、复盘会议议程及扩展决策卡，注明证据和审批点。",
        "Deliver a pilot proposal, sample and task plan, metric board, fee and responsibility table, review agenda and expansion decision card.",
      ],
      [
        "费用、数据使用、参与者责任或扩展门槛未确认时不得开始；小样本积极反馈不能直接推断规模化收益。",
        "Do not start before fees, data use, responsibilities and expansion gates are confirmed; positive small-sample feedback is not scale proof.",
      ],
    ),
    detail(
      [
        "收集采购要求、交付能力、资质证照、合同模板、服务级别、接入条件、保密要求和客户评审时间表，并核对证照有效期、数据处理条款和退出移交要求。",
        "Collect procurement requirements, delivery capability, qualifications, contract template, service levels, access conditions, confidentiality and review schedule; verify qualification expiry, data-processing terms and exit handoff requirements.",
      ],
      [
        "将供应合作拆成准入、接入、交付、报告和退出，比较服务范围与总成本，明确客户、供应商和我方的验收责任。",
        "Break supplier cooperation into qualification, onboarding, delivery, reporting and exit, comparing scope and total cost with acceptance duties.",
      ],
      [
        "交付供应商合作提案、资质与证据清单、服务指标、实施时间线和退出安排，逐项标注保密责任、审批人及替代方案。",
        "Deliver a supplier proposal, qualification evidence, service metrics, implementation timeline and exit plan with confidentiality, approvers and alternatives.",
      ],
      [
        "资质过期、服务边界模糊或合同未包含数据与退出条款时不得列为推荐；低报价不能替代安全和合规条件。",
        "Do not recommend expired qualifications, unclear scope or contracts lacking data and exit terms; low price cannot replace safety and compliance.",
      ],
    ),
  ],
  "strategy-brief": [
    detail(
      [
        "收集年度经营实际、目标版本、市场变化、能力盘点、资金和人员约束、关键风险及董事会或管理层的决策窗口。",
        "Collect annual operating actuals, goal versions, market changes, capability review, capital and staffing limits, risks and leadership decision windows.",
      ],
      [
        "以已批准目标为约束比较重点投入、维持和放弃事项，核对各目标占用的资源与相互依赖，并区分承诺、预测和外部假设。",
        "Compare investment, maintenance and stop choices against approved goals, checking resources and dependencies and separating commitments, forecasts and assumptions.",
      ],
      [
        "交付年度战略选择页、目标与投入对照表、放弃事项清单和季度检查信号，注明数据时点、决策人、关键假设与复审日期。",
        "Deliver an annual choice brief, goal-investment table, stop-doing list and quarterly signals with dates, decision owners, assumptions and reviews.",
      ],
      [
        "经营数据口径不一致或资源尚未批准时不得把目标写成承诺；明显相互冲突的重点须升级决策而非同时承诺。",
        "Do not commit goals on inconsistent data or unapproved resources; escalate conflicting priorities instead of promising all of them.",
      ],
    ),
    detail(
      [
        "收集各业务线收入、贡献毛利、现金占用、人员能力、客户依赖、战略匹配评估及共享成本分摊规则的版本。",
        "Collect business-line revenue, contribution margin, cash use, capabilities, client dependencies, strategic fit and allocation-rule versions.",
      ],
      [
        "比较保留、收缩、重组或追加投资的未来现金与能力影响，分别测算一次性退出成本和持续经营成本，避免平均分配预算。",
        "Compare retain, reduce, restructure or invest by future cash and capability, separating exit costs from ongoing costs rather than equal allocation.",
      ],
      [
        "输出业务组合矩阵、投入和退出情景表、资源转移计划及待管理层决策项，列明分摊公式、人员影响和依据日期。",
        "Deliver a portfolio matrix, investment and exit scenarios, resource transfer plan and leadership decisions with allocation formulas and dated evidence.",
      ],
      [
        "成本分摊口径未经财务复核、合同依赖不明或人员影响未经授权披露时保留待决，不将会计分摊误作可避免现金。",
        "Keep decisions open when allocations lack finance review, contracts are unclear or personnel details lack approval; allocations are not avoidable cash.",
      ],
    ),
    detail(
      [
        "收集增长基线、客户分群、获客渠道、转化漏斗、留存队列、服务成本、各渠道客户归因口径、单位经济和近期实验记录。",
        "Collect growth baseline, customer segments, acquisition channels, funnel conversions, retention cohorts, service cost, attribution definitions, unit economics and experiments.",
      ],
      [
        "比较获客、提升留存和扩大客户价值的路径，统一分母及观察窗口，评估渠道增量、回收期和容量瓶颈，不只看注册总量。",
        "Compare acquisition, retention and customer-value paths using consistent denominators and windows, assessing incrementality, payback and capacity.",
      ],
      [
        "交付增长路径图、关键指标树、实验组合和季度目标表，注明各项当前值、假设增量、负责人、观测窗口与停止条件。",
        "Deliver a growth roadmap, metric tree, experiment portfolio and quarterly targets with baselines, assumed lift, owners, windows and stop conditions.",
      ],
      [
        "用户定义、归因窗口或自然增长对照不明确时不得归因渠道成果；单位经济恶化或服务容量触线须调整扩张节奏。",
        "Do not attribute growth without user definitions, windows and organic controls; adjust pace when unit economics or service capacity degrades.",
      ],
    ),
    detail(
      [
        "收集现有商业模式、收入和成本来源、外部监管或技术变化、能力差距、转型提案、已批准资源及受影响团队意见。",
        "Collect the current business model, revenue and cost drivers, external changes, capability gaps, proposals, approved resources and team input.",
      ],
      [
        "将转型拆为探索、验证、迁移和规模化阶段，比较保留旧模式、双轨运行和切换的现金风险、客户连续性及退出成本。",
        "Phase transformation into exploration, validation, migration and scale, comparing legacy retention, dual run and cutover by risk and continuity.",
      ],
      [
        "输出转型阶段图、能力建设清单、旧新模式对照表和决策门槛，标注预算来源、里程碑、受影响客户及负责人。",
        "Deliver a transformation map, capability plan, old/new comparison and gates with funding, milestones, affected customers and owners.",
      ],
      [
        "管理层批准和客户迁移方案未完成前只能描述为提议；关键能力或现金门槛未达到时暂停规模化并保留旧服务安排。",
        "Describe as a proposal until leadership approval and client migration are ready; pause scaling below capability or cash gates and retain legacy service.",
      ],
    ),
    detail(
      [
        "收集目标市场规模来源、可服务客群、竞争报价、进入法规、渠道覆盖、支持成本和来源年份，标记估算范围。",
        "Collect dated market sources, serviceable segments, competitor prices, entry rules, channel coverage and support cost, noting estimate ranges.",
      ],
      [
        "按地区比较直接进入、伙伴合作、有限试点和暂缓，使用可触达市场而非总市场测算，并估计准入、服务与退出成本。",
        "Compare direct entry, partnership, pilot and deferral by region using addressable market and estimating access, support and exit costs.",
      ],
      [
        "交付区域优先级矩阵、进入路径对照、所需验证证据和阶段投资卡，写明数据时点、责任人、目标样本及复审门槛。",
        "Deliver a regional priority matrix, entry comparison, evidence needs and staged investment cards with dates, owners, samples and review gates.",
      ],
      [
        "法律准入、市场样本或服务能力未经核实不得标为可进入；预测规模不得代替可获取订单，低于试点门槛应停止投入。",
        "Do not label a region ready without verified legal access, market evidence and service capacity; forecasts do not equal orders and weak pilots stop.",
      ],
    ),
    detail(
      [
        "收集客户分层定义、按期留存与流失记录、续约金额、取消原因、服务工时、触达频次和历史挽回活动。",
        "Collect segment definitions, cohort retention and churn, renewal value, cancellation reasons, service hours, contact cadence and save campaigns.",
      ],
      [
        "按同期群和客户价值定位流失变化，比较产品改进、服务干预和续约沟通的可验证作用，区分挽回与自然续费。",
        "Locate churn by cohort and value, comparing product, service and renewal interventions while separating saves from natural renewals.",
      ],
      [
        "输出留存漏斗、重点客户风险分层、干预实验表和效果复核计划，列明触发信号、客户负责人、成本及数据更新时间。",
        "Deliver a retention funnel, account risk tiers, intervention tests and review plan with triggers, owners, costs and data dates.",
      ],
      [
        "流失定义和同期群窗口未统一时不得比较部门排名；个体客户风险信息只向有职责人员开放，低样本效果须标注不确定。",
        "Do not rank teams before churn definitions and cohort windows align; restrict account risks and label low-sample effects uncertain.",
      ],
    ),
    detail(
      [
        "收集各产品收入、毛利、生命周期、支持成本、客户任务、路线图投入、退出后的数据导出要求、替代能力及合同和系统退出依赖。",
        "Collect product revenue, margin, lifecycle, support cost, client tasks, roadmap investment, export obligations, alternatives and contract and system exit dependencies.",
      ],
      [
        "比较继续投资、聚焦重构、维持支持和退出的未来价值，识别组合内部的交叉依赖，并计算迁移、退款或长期维护责任。",
        "Compare invest, refocus, maintain and exit by future value, identifying portfolio dependencies and migration, refund or support obligations.",
      ],
      [
        "交付产品组合定位图、投入回报区间、客户迁移清单和退役决策门，列明假设、服务承诺、负责人及复审日期。",
        "Deliver a portfolio map, return ranges, client migration register and retirement gates with assumptions, obligations, owners and review dates.",
      ],
      [
        "无替代方案的关键客户、合同期或数据导出义务未确认时不得停止支持；未验证的收入预测不能单独支持投资结论。",
        "Do not end support before client alternatives, contract terms and export duties are confirmed; unvalidated revenue forecasts alone do not justify investment.",
      ],
    ),
    detail(
      [
        "收集各渠道覆盖与合同、获客成本、线索和成交口径、伙伴能力、客户重叠、渠道之间的线索交接记录、销售周期及渠道支持投入。",
        "Collect channel reach and contracts, acquisition cost, lead and sales definitions, partner capacity, customer overlap, lead handoffs, cycle and support cost.",
      ],
      [
        "分配直销、伙伴和数字渠道的目标角色，比较新增覆盖与重复归因，按增量客户和服务能力而非曝光量调整投入组合。",
        "Assign direct, partner and digital roles, comparing incremental reach with duplicate attribution and allocating by customers and service capacity.",
      ],
      [
        "交付渠道角色图、投入比例情景、归因规则、伙伴行动清单和季度复核表，标注排他条款、数据来源及负责人。",
        "Deliver channel roles, investment scenarios, attribution rules, partner actions and quarterly reviews with exclusivity, sources and owners.",
      ],
      [
        "合同限制、线索授权或归因重叠未解决时不得据单一渠道成本排名；伙伴目标必须以签署能力与实际覆盖为依据。",
        "Do not rank channels on cost before contract, lead rights and attribution are resolved; partner targets require signed capability and real coverage.",
      ],
    ),
    detail(
      [
        "收集当前技术能力、系统依赖、目标架构、待建岗位、维护成本、预算来源、现有系统故障与恢复记录、技术债和需要业务验证的能力主张。",
        "Collect current technology, dependencies, target architecture, roles to build, maintenance cost, funding, incident and recovery records, technical debt and claims to validate.",
      ],
      [
        "将建设工作按业务价值、依赖和不可逆风险排序，比较自建、采购、集成和延期，明确试验能否验证可用性与运维负担。",
        "Rank capability work by value, dependencies and irreversible risk, comparing build, buy, integrate and defer with tests for operations and fit.",
      ],
      [
        "输出能力差距图、技术路线图、方案对照和验证里程碑，标明现状证据、人员需求、维护责任和预算批准状态。",
        "Deliver a capability-gap map, technology roadmap, option comparison and validation milestones with evidence, staffing, owners and budget status.",
      ],
      [
        "目标架构不得冒充现有能力；安全审查、维护责任或迁移回退未落实时不得承诺关键业务依赖该方案。",
        "Do not portray target architecture as current capability; do not promise critical dependence before security, maintenance and rollback are ready.",
      ],
    ),
    detail(
      [
        "收集岗位结构、能力矩阵、业务优先级、关键岗位空缺、员工发展意愿、岗位接替与培训记录、流动数据和经授权的薪酬区间。",
        "Collect role structure, competency matrix, business priorities, critical vacancies, development interests, succession and training records, mobility data and authorized pay ranges.",
      ],
      [
        "比较内部培养、招聘、轮岗和外部支持的时间与能力覆盖，优先处理关键岗位风险，说明各方案对现有团队的负荷影响。",
        "Compare training, hiring, rotation and external support by time and coverage, prioritizing critical roles and workload impact.",
      ],
      [
        "交付人才能力缺口表、培养与招聘路线、关键岗位继任风险和季度复核指标，列明数据口径、负责人及隐私访问级别。",
        "Deliver a talent gap table, training and hiring roadmap, succession risks and quarterly metrics with definitions, owners and privacy access.",
      ],
      [
        "人员数据不足或未经授权时不得推断个体绩效或晋升；岗位编制和薪酬未批准不能作为团队承诺。",
        "Do not infer individual performance or promotion from incomplete or unauthorized data; unapproved headcount and pay are not commitments.",
      ],
    ),
    detail(
      [
        "收集流程端到端时长、单位成本、返工率、质量抽检、人员负荷、服务投诉、样本覆盖的业务高峰时段和当前控制要求的统一基线。",
        "Collect consistent end-to-end time, unit cost, rework, quality sampling, workload, complaints, sampled peak periods and control baselines.",
      ],
      [
        "定位瓶颈与等待环节，比较自动化、标准化、排班调整和流程合并的投入，计算节省并同步评估错误和合规影响。",
        "Locate bottlenecks and compare automation, standardization, staffing and consolidation, estimating savings alongside error and compliance effects.",
      ],
      [
        "输出流程瓶颈图、改进方案评分表、试点指标和实施节奏，记录基线样本、质量护栏、业务负责人及复测节点。",
        "Deliver a bottleneck map, improvement scorecard, pilot metrics and implementation cadence with baseline, quality guardrails, owner and retest.",
      ],
      [
        "改善只能以持续测量确认，不能用平均速度掩盖高风险失败；质量或法定控制下降时停止推广并恢复必要检查。",
        "Confirm improvement through sustained measures; average speed cannot hide high-risk failures, and rollout stops if quality or required controls decline.",
      ],
    ),
    detail(
      [
        "收集风险登记、事件记录、现有控制、影响范围、风险负责人、法规或合同要求、审计发现和治理委员会审议日期。",
        "Collect the risk register, incidents, controls, impact, owners, legal or contractual duties, audit findings and governance review dates.",
      ],
      [
        "按影响、发生依据、控制有效性和变化速度排序优先级，比较追加控制、转移和接受方案，明确资源与授权的先后关系。",
        "Prioritize by impact, likelihood evidence, control effectiveness and velocity; compare added controls, transfer and acceptance with authority and resources.",
      ],
      [
        "交付风险优先级地图、控制建设路线、接受权限矩阵和复审日历，逐项链接证据、行动责任人、触发指标及未决例外。",
        "Deliver a risk map, control roadmap, acceptance authority matrix and review calendar with evidence, owners, triggers and open exceptions.",
      ],
      [
        "剩余风险超出已批准承受度或控制只有设计未测试时不得标为已处置；接受决定须由有授权的风险所有者签字。",
        "Do not mark risk treated when residual risk exceeds tolerance or controls are untested; acceptance requires an authorized risk owner.",
      ],
    ),
  ],
  "project-charter": [
    detail(
      [
        "收集立项申请、业务问题、目标基线、预算假设、发起人资料、拟交付成果和现行授权矩阵，记录文件版本、来源及尚未确认的资源。",
        "Collect the project request, business problem, goal baseline, budget assumptions, sponsor information, proposed deliverables and authority matrix, recording versions, sources and unconfirmed resources.",
      ],
      [
        "将项目目的转为可衡量成果，划清纳入与排除范围，梳理发起人、项目负责人及决策权限，并对照预算和依赖设定拟议里程碑。",
        "Translate the purpose into measurable outcomes, included and excluded scope, sponsor and project-owner roles, decision rights and proposed milestones aligned with budget and dependencies.",
      ],
      [
        "交付带版本及批准状态的章程草案、范围与成果表、责任矩阵和里程碑清单，列出资金假设、审批人、待决问题及复核日期。",
        "Deliver a versioned draft charter with approval status, scope and outcome table, responsibility matrix and milestones, including funding assumptions, approvers, open issues and review dates.",
      ],
      [
        "发起人权限、预算或成果验收标准未确认时保留待审，不得伪造签署或把草案描述为已生效授权；正式决定须由有权人员作出。",
        "Keep authority, funding and acceptance criteria pending when unconfirmed; never fabricate signatures or describe a draft as effective authorization, which requires an authorized decision.",
      ],
    ),
    detail(
      [
        "收集已批准章程、扩展需求、现有范围和预算、资源占用、验收约定及关联项目依赖，核对各版本的生效状态和变更申请来源。",
        "Collect the approved charter, expansion request, current scope and budget, resource use, acceptance terms and related dependencies, verifying version status and the request source.",
      ],
      [
        "逐项比较原章程与拟新增工作，分析预算、人员、期限和验收变化，说明被挤占的既有承诺以及可选的分期或缩减方案。",
        "Compare the existing charter with proposed additions by budget, staffing, schedule and acceptance, identifying displaced commitments and staged or reduced-scope alternatives.",
      ],
      [
        "交付章程变更对照、增量资源和依赖表、修订后的验收草案及决策请求，标明原批准依据、变更责任人和待签署状态。",
        "Deliver a charter-change comparison, incremental resources and dependencies, revised acceptance draft and decision request with original approval, owners and pending sign-off.",
      ],
      [
        "新增范围和预算未经授权批准时不得作为原项目承诺，客户或跨部门验收变化须由相关责任人复核，争议与缺口持续保留待决。",
        "Do not treat unapproved scope or budget as an existing commitment; relevant owners must review customer and cross-team acceptance changes, with disputes and gaps kept open.",
      ],
    ),
    detail(
      [
        "收集暂停决定及原因、停工期间遗留事项、合同与通知记录、现有成果状态、恢复条件、可用人员和资金以及未关闭风险。",
        "Collect the pause decision and reasons, outstanding work, contracts and notices, deliverable status, restart conditions, available people and funding, and unresolved risks.",
      ],
      [
        "核对暂停原因是否消除，依次检查合同义务、资源可用性和外部依赖，重新排列关键路径与里程碑，并比较重启、延后和收尾选项。",
        "Check whether pause causes are resolved, then assess obligations, capacity and external dependencies; resequence the critical path and compare restart, delay and closure.",
      ],
      [
        "输出重启章程草案、前置条件核验表、重排里程碑和遗留风险台账，记录每项证据、责任人、复核日期及拟请示的重启权限。",
        "Deliver a restart charter draft, prerequisite checklist, resequenced milestones and risk register with evidence, owners, review dates and the requested restart authority.",
      ],
      [
        "资源未重新落实、合同义务或暂停风险仍未解决时不得宣布项目已重启；重启和资源安排须由具备权限的人审议并留下记录。",
        "Do not announce a restart while resources, contractual obligations or pause risks remain unresolved; authorized people must review and record restart and resource decisions.",
      ],
    ),
    detail(
      [
        "收集试点问题、参与对象与样本、观察周期、预算上限、基线指标、数据使用范围和成功门槛，核实参与方与资料来源。",
        "Collect the pilot question, participants and sample, observation period, budget cap, baseline metrics, data-use scope and success thresholds, verifying parties and sources.",
      ],
      [
        "限定试点地点、任务和期限，安排基线、运行、评估及退出步骤，分别定义扩展、延长、调整和终止的证据要求与责任。",
        "Limit pilot sites, tasks and duration; plan baseline, operation, evaluation and exit, defining evidence and ownership for expansion, extension, adjustment or termination.",
      ],
      [
        "交付试点章程草案、样本与指标表、数据处理清单和评估日程，列明负责人、停止信号、决策节点、参与者通知及资源假设。",
        "Deliver a pilot charter draft, sample and metric table, data-handling inventory and evaluation schedule with owners, stop signals, decision gates, notices and resource assumptions.",
      ],
      [
        "参与授权、数据处理或停止安排未确认时不得启动，试点达到门槛也不自动构成扩展批准；小样本结论须保留适用边界。",
        "Do not start without confirmed participation, data handling and stop arrangements; meeting a threshold does not itself approve expansion, and small-sample limits remain explicit.",
      ],
    ),
    detail(
      [
        "收集各部门职责、项目目标、共享人员与预算、相互冲突的优先级、现有决策权限及跨部门接口，记录争议来源和负责人。",
        "Collect departmental duties, project goals, shared people and budgets, competing priorities, decision rights and interfaces, recording dispute sources and owners.",
      ],
      [
        "按成果、交接与决策事项划分部门责任，比较资源占用和冲突处理路径，明确提出、执行、审议及最终批准的不同角色。",
        "Assign departmental responsibility by outcome, handoff and decision, compare resource conflicts and resolution paths, and distinguish proposing, executing, reviewing and approving roles.",
      ],
      [
        "输出跨部门章程草案、责任与审批矩阵、共享资源计划和接口清单，逐项列出交付条件、升级联系人、未决冲突及确认时间。",
        "Deliver a cross-functional draft charter, responsibility and approval matrix, shared-resource plan and interface register with handoff conditions, escalation contacts, conflicts and confirmation dates.",
      ],
      [
        "责任人、审批人或资源归属不明时不得推定部门同意，存在目标冲突应提交有权管理者决策；未经确认的协作安排保持草案。",
        "Do not infer departmental agreement when owners, approvers or resources are unclear; escalate conflicting goals to authorized managers and retain unconfirmed arrangements as drafts.",
      ],
    ),
    detail(
      [
        "收集现行流程、时长与质量基线、改造目标、例外案例、系统约束、受影响岗位和培训资源，确认流程文件版本与测量口径。",
        "Collect the current process, time and quality baselines, change goals, exceptions, system constraints, affected roles and training resources, verifying versions and measurement definitions.",
      ],
      [
        "定义拟改善成果、阶段门和推广范围，将例外处理、员工培训与系统准备列为依赖，并比较分批推广和维持现状的影响。",
        "Define proposed outcomes, phase gates and rollout scope; include exception handling, staff training and system readiness as dependencies, comparing phased rollout with the status quo.",
      ],
      [
        "交付流程改造章程草案、基线与目标表、阶段验收和推广计划，注明例外负责人、培训准备证据、质量护栏及复核时间。",
        "Deliver a process-change charter draft, baseline and target table, phase acceptance and rollout plan with exception owners, training evidence, quality safeguards and reviews.",
      ],
      [
        "基线或例外流程未经业务负责人核实、培训与控制尚未准备时不得宣称可以推广；改造和制度变化须由有权人员另行批准。",
        "Do not claim rollout readiness without verified baselines, exception paths, training and controls; authorized owners must separately approve process and policy changes.",
      ],
    ),
    detail(
      [
        "收集各集成系统及负责人、接口规范、数据流、测试环境、版本兼容资料、权限申请和既有服务依赖，标明资料日期与缺口。",
        "Collect integrated systems and owners, interface specifications, data flows, test environments, compatibility, access requests and service dependencies with dates and gaps.",
      ],
      [
        "划定系统边界及数据交接责任，安排接口授权、联调、验收与回退验证，区分已经验证的能力、拟议设计和需要补测的假设。",
        "Define system boundaries and data-handoff duties; plan access approval, integration tests, acceptance and rollback verification, separating verified capabilities from proposals and untested assumptions.",
      ],
      [
        "输出集成章程草案、接口责任矩阵、联调与验收计划及回退条件，记录数据权限、兼容证据、环境负责人和关键决策节点。",
        "Deliver an integration charter draft, interface responsibility matrix, test and acceptance plan and rollback conditions with data permissions, compatibility evidence, environment owners and gates.",
      ],
      [
        "接口访问、数据用途或兼容性未经授权和验证时不得连接生产环境，也不得声称集成完成；实际权限变更须由有权人员批准执行。",
        "Do not connect production or claim integration complete before access, data use and compatibility are authorized and verified; authorized personnel must approve actual access changes.",
      ],
    ),
    detail(
      [
        "收集经授权的组织现状、调整方案、受影响岗位范围、现有职责、过渡依赖、沟通计划及适用的人事流程和审核联系人。",
        "Collect authorized organizational context, proposed changes, affected role scope, current duties, transition dependencies, communications and applicable people-process reviewers.",
      ],
      [
        "定义拟议组织职责、工作交接与过渡里程碑，安排对受影响团队的沟通和反馈渠道，将尚待决定的人员事项与组织目标分开。",
        "Define proposed organizational duties, handoffs and transition milestones, plan communication and feedback for affected teams, and separate pending personnel decisions from organizational goals.",
      ],
      [
        "交付限定分发范围的调整章程草案、职责交接表、沟通日程和过渡风险清单，记录审批责任、待确认事项及阶段复审节点。",
        "Deliver a distribution-limited change charter draft, responsibility handoff, communication schedule and transition risks with approval owners, open items and reviews.",
      ],
      [
        "不得在公开章程中披露敏感人事资料，也不得将拟议岗位或人员安排写成已决定；劳动和隐私事项交有资格人员依制度复核。",
        "Do not disclose sensitive personnel data in a public charter or present proposed placements as decisions; qualified owners must review employment and privacy matters under policy.",
      ],
    ),
    detail(
      [
        "收集客户合同及附件、实施范围、双方联系人与职责、客户提供物、验收条件、变更条款和交付窗口，核对签署版本及授权状态。",
        "Collect the client contract and attachments, implementation scope, contacts and duties, client inputs, acceptance, change terms and delivery windows, checking signed versions and authority.",
      ],
      [
        "对照合同分解实施成果、客户依赖、交接步骤与验收责任，设定问题升级和范围变更路径，并明确任何拟调整的时间或资源假设。",
        "Decompose contractual outcomes, client dependencies, handoffs and acceptance duties; define escalation and scope-change paths and identify proposed schedule or resource assumptions.",
      ],
      [
        "交付客户实施章程草案、双方责任矩阵、依赖与里程碑表及验收证据清单，逐项关联合同依据、客户确认人和待审变更。",
        "Deliver a client implementation charter draft, joint responsibility matrix, dependency and milestone table and acceptance evidence list linked to contract clauses, client reviewers and pending changes.",
      ],
      [
        "章程内容不得扩大或替代合同授权，客户依赖或验收变更未经双方有权人员确认时保留待决，不得将计划日期写成新承诺。",
        "The charter must not expand or replace contractual authority; keep client dependencies and acceptance changes pending authorized bilateral confirmation and do not turn planned dates into new commitments.",
      ],
    ),
    detail(
      [
        "收集研究问题、参与机构、方法草案、样本与数据来源、资金和资源、成果归属约定以及伦理、隐私和知识产权审查要求。",
        "Collect the research question, institutions, draft methods, samples and data sources, funding and resources, outcome ownership and ethics, privacy and intellectual-property review requirements.",
      ],
      [
        "明确研究边界、机构分工、数据访问及成果交付，安排方法复核、伦理审查和阶段检查，并区分已有协议与尚需协商的权利。",
        "Define research scope, institutional duties, data access and deliverables; plan method, ethics and stage reviews, separating existing agreements from rights still to negotiate.",
      ],
      [
        "输出研究章程草案、机构责任表、数据与成果归属清单、审查日程和里程碑，注明资料来源、审批状态、联系人及开放问题。",
        "Deliver a research charter draft, institutional responsibility table, data and outcome ownership register, review schedule and milestones with sources, approval status, contacts and open questions.",
      ],
      [
        "伦理审查、隐私授权或成果权属未确认前不得收集或共享相关数据；法律解释及协议条款须由合格人员审核，草案不代表批准。",
        "Do not collect or share relevant data before ethics, privacy authorization and ownership are confirmed; qualified reviewers must assess legal interpretations and terms, and a draft is not approval.",
      ],
    ),
    detail(
      [
        "收集供应商协议、工作说明、交付要求、服务指标、双方接口人、验收标准、保密义务和升级约定，记录文件版本及有效期限。",
        "Collect the supplier agreement, statement of work, delivery requirements, service metrics, contacts, acceptance criteria, confidentiality and escalation terms with versions and dates.",
      ],
      [
        "按阶段梳理供应商成果、我方提供物和交付接口，明确检查、返工、验收与问题升级责任，并对照合同识别拟议变更。",
        "Map supplier outcomes, internal inputs and interfaces by phase, defining inspection, rework, acceptance and escalation responsibilities and identifying proposed contract changes.",
      ],
      [
        "交付供应商项目章程草案、交付节点与验收表、沟通升级清单和保密依赖，标明合同依据、责任人、证据形式及待确认事项。",
        "Deliver a supplier charter draft, delivery and acceptance table, escalation contacts and confidentiality dependencies with contractual basis, owners, evidence and open items.",
      ],
      [
        "供应商职责、保密或验收条款与合同冲突时不得自行改写，须提交合同负责人和有权人员审议；未确认的阶段成果不能标为验收。",
        "Do not rewrite supplier duties, confidentiality or acceptance terms that conflict with the contract; refer them to authorized contract owners and do not mark unconfirmed work accepted.",
      ],
    ),
    detail(
      [
        "收集合作目标、试点地点、参与方资源、执行期限、共享数据需求、现有协议、评估方式和合作结束后的资料处理要求。",
        "Collect cooperation goals, pilot locations, each party's resources, duration, shared-data needs, existing agreements, evaluation and post-exit information handling.",
      ],
      [
        "设计受限试点和双方交接，明确投入、观察指标、评估节点与继续、调整或退出选项，同时核对共享数据的用途和责任。",
        "Design a bounded pilot and handoffs, defining contributions, observation metrics, evaluation gates and continuation, adjustment or exit options while checking data purposes and ownership.",
      ],
      [
        "交付合作试点章程草案、资源与职责表、数据共享申请、评估议程和退出清单，注明各方审批人、假设、期限及待决问题。",
        "Deliver a partnership pilot charter draft, resource and responsibility table, data-sharing request, evaluation agenda and exit checklist with approvers, assumptions, dates and open issues.",
      ],
      [
        "共享数据和试点投入未经各方有权人员授权不得启动，试点结果不能自动形成长期合作承诺；退出时的数据处置须按已批准安排执行。",
        "Do not start shared data use or pilot commitments without each party's authorization; results do not automatically create a long-term commitment, and exit handling follows approved arrangements.",
      ],
    ),
  ],
  "policy-playbook": [
    detail(
      [
        "收集信息资产清单、数据类别、敏感级别、现行标记与访问权限、处理流程及适用制度来源，记录资产负责人、版本和缺失项。",
        "Collect information assets, data categories, sensitivity, current labels and access, handling processes and policy sources, recording owners, versions and gaps.",
      ],
      [
        "按已确认标准设计分类、标记、存储、传递与例外流程，分别说明责任角色、拟议控制和权限审批，并核对实际控制的证据。",
        "Design classification, labeling, storage, transfer and exception processes against confirmed standards, identifying roles, proposed controls, approvals and evidence of actual controls.",
      ],
      [
        "交付分类制度草案、处理与标记矩阵、例外申请表及权限核验清单，注明适用范围、制度来源、责任人、审批状态与复审日期。",
        "Deliver a draft classification policy, handling and labeling matrix, exception form and access-verification checklist with scope, sources, owners, approval status and review dates.",
      ],
      [
        "分类建议不等于系统权限已经配置，敏感信息的访问和制度变更须由有权人员审批并验证；法律适用性不明时交合格人员复核。",
        "Classification recommendations do not configure access; authorized owners must approve and verify sensitive access and policy changes, and qualified reviewers assess uncertain legal applicability.",
      ],
    ),
    detail(
      [
        "收集记录类型、业务用途、存储位置、当前保留与删除流程、责任人及相关制度或法规原文，标记来源版本、地区和待核验期限。",
        "Collect record types, business purposes, storage, current retention and deletion, owners and source policies or legal texts, noting versions, jurisdictions and periods to verify.",
      ],
      [
        "逐类梳理保留依据、触发起算事件、保存责任与到期处理，区分业务建议、已批准期限和法律待审问题，并考虑暂停删除情形。",
        "Map each record to its retention basis, start trigger, custodian and expiry handling, separating business proposals, approved periods and legal questions, including deletion holds.",
      ],
      [
        "输出记录保留制度草案、分类期限表、到期处理流程和待法务确认清单，标注存储位置、负责人、依据链接及定期复审节点。",
        "Deliver a draft retention policy, category-period table, expiry process and legal-review list with storage, owners, source links and periodic review points.",
      ],
      [
        "不得凭空编造法定保留年限，也不得将草案作为删除授权；法务和记录负责人应确认适用期限、保全要求及实际处置决定。",
        "Never invent statutory periods or treat a draft as deletion authority; legal and records owners must confirm applicable periods, holds and actual disposition decisions.",
      ],
    ),
    detail(
      [
        "收集内部与外部沟通渠道、信息类型、现有通知规则、响应责任、升级联系人、留痕方式及敏感内容的传递限制和制度版本。",
        "Collect internal and external channels, information types, notification rules, response owners, escalation contacts, records, sensitive-content restrictions and policy versions.",
      ],
      [
        "按事项紧急度和信息级别梳理通知、响应、升级及归档路径，明确渠道选择、替补联系人和无法及时响应时的处理条件。",
        "Map notification, response, escalation and archiving by urgency and sensitivity, defining channel choice, backup contacts and handling when timely response is unavailable.",
      ],
      [
        "交付沟通制度草案、渠道与信息级别对照表、响应和升级矩阵及留痕示例，列明适用范围、负责人、审批状态和复审日期。",
        "Deliver a draft communications policy, channel-sensitivity table, response and escalation matrix and record examples with scope, owners, approval status and review dates.",
      ],
      [
        "未经核实的渠道不得标为可传递敏感信息，通知时限和对外承诺须依据现行制度及授权确认；制度草案不改变实际渠道权限。",
        "Do not label an unverified channel suitable for sensitive information; confirm deadlines and external commitments under current policy and authority, and do not treat drafts as access changes.",
      ],
    ),
    detail(
      [
        "收集远程办公现状、适用岗位、现行劳动和安全制度、设备要求、申请流程、协作安排及当地规则来源，记录地区和版本。",
        "Collect current remote work, eligible roles, employment and security policies, equipment requirements, request processes, collaboration arrangements and dated local sources.",
      ],
      [
        "梳理申请与审批、工作时间安排、设备使用、信息保护和沟通方式，区分公司拟议做法、现行制度及需要当地专业审查的事项。",
        "Map requests and approvals, work arrangements, equipment, information protection and communication, separating proposals, current policy and matters requiring local professional review.",
      ],
      [
        "交付远程办公制度草案、岗位适用性与责任表、申请流程及设备检查清单，列明员工反馈渠道、审批人、例外条件和复审日。",
        "Deliver a remote-work policy draft, role applicability and responsibility table, request process and equipment checklist with feedback, approvers, exceptions and review dates.",
      ],
      [
        "不得假设各地劳动或安全要求相同，也不将草案视为员工远程办公批准；涉及法律解释和个人安排须由合格及有权人员复核。",
        "Do not assume employment or safety requirements are uniform or treat a draft as remote-work approval; qualified and authorized people must review legal interpretation and individual arrangements.",
      ],
    ),
    detail(
      [
        "收集岗位申请与编制授权、招聘流程、职位描述、筛选和面试标准、录用审批及候选人数据处理制度，核对适用范围与版本。",
        "Collect role requests and headcount authority, hiring processes, job descriptions, screening and interview criteria, offer approvals and candidate-data policy, checking scope and versions.",
      ],
      [
        "按岗位申请、公开招聘、筛选、结构化评估和录用审批梳理责任与记录，检查评价条件是否与工作相关并安排异议升级。",
        "Map responsibilities and records for requests, advertising, screening, structured assessment and offer approval, checking job relevance and providing an escalation path.",
      ],
      [
        "交付招聘制度草案、阶段责任和审批矩阵、候选人评估表及数据处理清单，记录依据、保管人、反馈渠道和待审条款。",
        "Deliver a hiring policy draft, stage responsibility and approval matrix, candidate assessment form and data-handling list with sources, custodians, feedback channels and open clauses.",
      ],
      [
        "不得加入歧视性条件或收集无关候选人隐私，录用建议不等于已批准录用；适用法律和个人信息处理须由合格负责人复核。",
        "Do not add discriminatory criteria or collect irrelevant candidate data; a recommendation is not an approved hire, and qualified owners must review law and personal-data handling.",
      ],
    ),
    detail(
      [
        "收集现行入职流程、必要材料清单、岗位职责、入职时间、账号申请与回收规则、培训安排和各环节联系人及制度版本。",
        "Collect the current onboarding process, necessary documents, role duties, start dates, account request and removal rules, training, contacts and policy versions.",
      ],
      [
        "按入职前、首日及试用阶段排列材料核验、设备交接、权限申请和岗位支持，明确员工、主管、人事与系统负责人的边界。",
        "Sequence document checks, equipment handoff, access requests and role support before arrival, on day one and during probation, assigning employee, manager, HR and system-owner duties.",
      ],
      [
        "输出入职制度草案、阶段责任清单、账号申请与交接表以及反馈节点，标明每项材料的用途、保管责任、审批人和完成证据。",
        "Deliver an onboarding policy draft, phase checklist, account request and handoff table and feedback points with document purposes, custodians, approvers and completion evidence.",
      ],
      [
        "只收集岗位和制度所需的个人信息，不得把申请账号写成已经授予权限；资料使用、访问及试用决定须依授权由负责人确认。",
        "Collect only role- and policy-necessary personal data and do not equate an account request with granted access; authorized owners confirm data use, access and probation decisions.",
      ],
    ),
    detail(
      [
        "收集岗位培训需求、课程目录、现有计划、讲师和学员角色、可用时数、评价标准、学习记录及适用制度的批准版本。",
        "Collect role training needs, course catalog, current plans, instructor and learner roles, available hours, assessment criteria, learning records and approved policy versions.",
      ],
      [
        "建立需求确认、年度计划、课程组织、学习记录及反馈复审流程，将出勤、练习表现和岗位能力验证设为不同的记录状态。",
        "Establish needs review, planning, delivery, learning records and feedback, using separate statuses for attendance, practice performance and demonstrated job competence.",
      ],
      [
        "交付培训制度草案、课程与岗位映射、责任分工、评价记录模板及补训安排，注明评估依据、数据保管人、审批状态与复审期。",
        "Deliver a training policy draft, course-role map, responsibilities, assessment template and remediation plan with criteria, data custodian, approval status and review period.",
      ],
      [
        "出勤、邀请或结课记录不能证明能力达标，评价和人员数据应限于授权用途；必要培训及考核标准须由负责人员确认。",
        "Attendance, invitations or course completion do not prove competence; restrict assessment and personnel data to authorized purposes and have responsible owners confirm required standards.",
      ],
    ),
    detail(
      [
        "收集利益冲突定义、适用人员范围、现行治理制度、申报渠道、处理权限、历史例外和复审流程，核对资料版本与保密要求。",
        "Collect conflict-of-interest definitions, covered people, governance policy, disclosure channels, authority, prior exceptions and review processes, checking versions and confidentiality.",
      ],
      [
        "设计识别、主动申报、独立审查、回避或其他处理及定期复审路径，区分事实、潜在冲突和有权人员尚未作出的判断。",
        "Design identification, disclosure, independent review, recusal or other treatment and periodic review, separating facts, potential conflicts and judgments not yet made by authorized reviewers.",
      ],
      [
        "交付利益冲突制度草案、申报表、处理责任矩阵及复审台账，注明接收人、保密范围、决定权限、例外期限和申诉渠道。",
        "Deliver a conflict-of-interest policy draft, disclosure form, treatment responsibility matrix and review register with recipients, confidentiality, decision authority, expiry and appeal channels.",
      ],
      [
        "不得要求披露与冲突判断无关的隐私，也不得由草案自动认定违规或批准例外；具体处理须经有权人员审查并限制信息访问。",
        "Do not request unrelated private information or let a draft determine misconduct or approve exceptions; authorized reviewers must decide individual cases with restricted access.",
      ],
    ),
    detail(
      [
        "收集现行采购制度、经批准的阈值与授权矩阵、预算来源、供应商规则、询价要求及采购记录，标明金额口径和版本。",
        "Collect current procurement policy, approved thresholds and authority matrix, funding, supplier rules, quotation requirements and records, noting amount definitions and versions.",
      ],
      [
        "梳理需求申请、预算核对、询价比较、审批、下单交接和记录保存，按已有阈值确定拟适用路径并单列例外和利益冲突。",
        "Map requests, budget checks, quotation comparisons, approval, order handoff and records, identifying paths under existing thresholds and separately listing exceptions and conflicts.",
      ],
      [
        "交付采购制度草案、阈值与审批对照、询价记录模板及例外台账，注明金额依据、责任角色、授权人、材料来源和复审节点。",
        "Deliver a procurement policy draft, threshold and approval table, quotation template and exception register with amount basis, roles, authorizers, sources and reviews.",
      ],
      [
        "未经确认不得编造采购金额、询价数量或职位授权，拟议流程不构成采购批准；例外须由有权人员按现行制度审议并留痕。",
        "Do not invent thresholds, quote counts or role authority; a proposed process is not procurement approval, and authorized owners must review and record exceptions under current policy.",
      ],
    ),
    detail(
      [
        "收集供应商分类、准入标准、资质文件、合同条款、服务表现、风险记录和退出要求，标明各项证据的有效期与责任部门。",
        "Collect supplier categories, entry criteria, qualifications, contracts, service performance, risks and exit requirements, recording evidence expiry and responsible departments.",
      ],
      [
        "按供应商风险和服务类型设计准入、定期评估、问题升级及退出流程，明确合同复核、资料共享与持续监控的责任边界。",
        "Design onboarding, periodic assessment, escalation and exit by supplier risk and service type, defining responsibility for contract review, data sharing and ongoing monitoring.",
      ],
      [
        "交付供应商管理制度草案、准入与复评清单、表现及风险台账和退出交接表，列明审批人、数据用途、证据状态和复核时间。",
        "Deliver a supplier-management policy draft, entry and reassessment checklist, performance and risk register and exit handoff with approvers, data purposes, evidence and review dates.",
      ],
      [
        "资质、合同或共享范围未经核实时不得将供应商标为已准入，数据访问和例外须经有权人员批准；低报价不能替代必需审查。",
        "Do not mark a supplier admitted without verified qualifications, contract and sharing scope; authorized owners approve data access and exceptions, and low price cannot replace required review.",
      ],
    ),
    detail(
      [
        "收集预算版本、费用类别、现行财务制度、岗位审批矩阵、报销及例外记录，核对金额单位、适用期间、责任部门和资料来源。",
        "Collect budget versions, expense categories, finance policy, role approval matrix, reimbursement and exception records, verifying units, periods, departments and sources.",
      ],
      [
        "按费用申请、预算核对、分级审批、支付交接和审计留痕梳理步骤，区分既有授权范围、拟议调整和超过权限时的升级路径。",
        "Map expense requests, budget checks, tiered approval, payment handoff and audit records, separating existing authority, proposed changes and escalation beyond authority.",
      ],
      [
        "交付费用审批制度草案、岗位与金额矩阵、例外申请模板和审计记录清单，标明费用口径、审批人、版本、待核事项及复审日。",
        "Deliver an expense-approval policy draft, role and amount matrix, exception template and audit checklist with expense definitions, approvers, versions, open checks and review dates.",
      ],
      [
        "岗位权限、金额口径或预算未核实时不得虚构批准限额，制度草案不构成付款授权；具体审批和例外须由有权财务人员决定。",
        "Do not invent approval limits when role authority, amount definitions or budgets are unverified; drafts do not authorize payment, and authorized finance owners decide approvals and exceptions.",
      ],
    ),
    detail(
      [
        "收集系统目录、业务角色、现有权限、账号申请记录、审批矩阵、定期复核及岗位变动和离职流程，标明系统负责人和版本。",
        "Collect the system inventory, business roles, current permissions, account requests, approval matrix, periodic reviews and role-change and departure processes with owners and versions.",
      ],
      [
        "定义申请、业务及系统审批、最小权限配置、定期复核、变更和撤销的责任与记录，分别列出制度建议和需要实测的控制。",
        "Define responsibilities and records for requests, business and system approvals, least-privilege configuration, periodic review, changes and revocation, separating recommendations from controls to test.",
      ],
      [
        "交付访问管理制度草案、角色权限与审批矩阵、复核清单和离职撤权流程，记录系统范围、责任人、证据、例外期限及复审日。",
        "Deliver an access-management policy draft, role-permission and approval matrix, review checklist and departure revocation process with systems, owners, evidence, exception expiry and reviews.",
      ],
      [
        "制度建议和账号申请不代表实际权限已变更或撤销，所有配置须经授权人员批准执行并复核；权限状态不明时保留待核验。",
        "A policy recommendation or request does not mean access has been changed or revoked; authorized people must approve, execute and verify configuration, leaving unknown status unverified.",
      ],
    ),
  ],
  sop: [
    detail(
      [
        "收集设备说明书、操作授权、点检表、维护记录、故障告警、安全隔离要求和班次负责人，核对设备型号及文件版本。",
        "Collect the equipment manual, operator authorization, inspection and maintenance records, alarms, isolation requirements and shift owner for the correct model and version.",
      ],
      [
        "按开机前检查、启动、运行监测、正常停机和交接顺序编排动作，注明每一步的观察值、操作人以及异常时的停止路径。",
        "Sequence pre-start checks, startup, monitoring, normal shutdown and handoff, specifying observations, operators and abnormal-stop paths.",
      ],
      [
        "交付设备操作规程、开停机检查单、运行记录和故障升级卡，逐项列出适用设备、步骤编号、确认签名及维护联系人。",
        "Deliver an equipment SOP, startup/shutdown checklist, operation log and escalation card with model, step numbers, sign-offs and maintenance contacts.",
      ],
      [
        "保护装置失效、读数超出设备批准范围或操作人无授权时立即停止使用并隔离上报；不得以临时经验替代厂家安全要求。",
        "Stop, isolate and escalate failed guards, readings outside approved limits or unauthorized operation; informal practice cannot replace manufacturer safety rules.",
      ],
    ),
    detail(
      [
        "收集班次排班、未结工单、设备和安全状态、生产记录、异常处置、尚未恢复设备的隔离措施、联系名单与交接双方的授权职责。",
        "Collect shift schedules, open work orders, equipment and safety status, production logs, exceptions, isolation measures, contacts and both parties' responsibilities.",
      ],
      [
        "按交班准备、现场核对、未结事项说明、接班确认和责任转移排序，逐项核实风险状态与下一次检查时间。",
        "Sequence preparation, onsite reconciliation, open-item briefing, receipt confirmation and responsibility transfer, checking risk status and next inspection.",
      ],
      [
        "输出交接记录表、未结事项清单和安全状态核对表，列明交接时间、位置、风险、下一步负责人、时限及双方签收。",
        "Deliver a shift handoff record, open-item list and safety checklist with time, location, risk, next owner, deadline and both signatures.",
      ],
      [
        "接班人未确认、安全状态不明或重大异常未移交时不得视为完成交接；跨班事项需保留原责任并及时升级。",
        "Do not complete handoff without recipient confirmation, known safety status and transfer of major exceptions; retain ownership and escalate.",
      ],
    ),
    detail(
      [
        "收集巡检区域、路线、频次、设备编号、判定标准、历史异常、上次未能检查的点位、现场进入权限、安全要求和当班联络方式。",
        "Collect inspection areas, route, frequency, equipment IDs, criteria, prior exceptions, previously missed points, entry permissions, safety requirements and contacts.",
      ],
      [
        "按路线列出每个观察点、检查方法、记录字段和升级动作，区分可以现场处理的偏差与必须停止进入的危险状况。",
        "List observation points, methods, fields and escalation by route, distinguishing locally resolvable deviations from conditions requiring withdrawal.",
      ],
      [
        "交付巡检路线表、逐点记录单、异常升级树和复查计划，注明检查人、时间、位置、读数、照片依据及关闭确认人。",
        "Deliver a route table, point-by-point log, escalation tree and recheck plan with inspector, time, location, readings, evidence and closer.",
      ],
      [
        "危险区域进入许可缺失、设备带电状态不明或环境超出已批准条件时不得进入；无法检查的点位保留未完成并报告。",
        "Do not enter hazardous areas without permission, known electrical status and approved conditions; report unchecked points as incomplete.",
      ],
    ),
    detail(
      [
        "收集适用检验标准版本、批次和数量、已批准抽样规则、测量设备校准记录、缺陷分类、复检负责人及不合格品处置要求。",
        "Collect the inspection standard, batch and quantity, approved sampling rules, measurement calibration, defect categories, reinspection owner and nonconformance process.",
      ],
      [
        "按批次确认、抽样、测量、判定、隔离和复核顺序编写操作，说明记录单位、边界值处理以及复测和升级责任。",
        "Sequence batch confirmation, sampling, measurement, judgment, isolation and review, specifying units, boundary values, retesting and escalation.",
      ],
      [
        "输出批次抽检记录、测量结果表、不合格品隔离单及复验清单，写明标准版本、样本编号、判定人和最终处置证据。",
        "Deliver a batch inspection record, measurements, quarantine form and reinspection checklist with standard version, sample IDs, judge and disposition evidence.",
      ],
      [
        "不得自行编造抽样比例或接收阈值；标准不清、量具校准失效或批次标识不一致时暂停判定并由质量负责人确认。",
        "Never invent sample rates or acceptance limits; pause for unclear standards, expired calibration or mismatched batch IDs and obtain quality approval.",
      ],
    ),
    detail(
      [
        "收集服务请求入口、服务目录、客户信息字段、优先级标准、响应时限、处理权限、客户身份核验要求、知识库和升级联系人。",
        "Collect request channels, service catalog, customer fields, priority rules, response times, authority, identity checks, knowledge base and escalation contacts.",
      ],
      [
        "从受理、身份核验、分类、处理、客户反馈到关闭逐步规定动作，未确认需求和超范围请求分别进入澄清或升级分支。",
        "Specify intake, identity checks, classification, handling, feedback and closure, routing unconfirmed needs and out-of-scope requests separately.",
      ],
      [
        "交付服务受理规程、请求分类表、回复模板、处理记录和关闭核对单，列出责任人、时限、证据链接及待客户确认项。",
        "Deliver an intake SOP, classification table, response templates, handling log and closure checklist with owners, deadlines, evidence and pending confirmations.",
      ],
      [
        "仅按授权范围查看客户资料，不得将未确认请求或临时答复标为已解决；超出权限的承诺必须交授权人处理。",
        "Access client data only as authorized; do not close unconfirmed requests or temporary responses, and escalate commitments outside authority.",
      ],
    ),
    detail(
      [
        "收集投诉渠道、受理范围、处理权限、回应期限、现行制度、历史记录、相关合同的争议条款、证据保全要求及客户联系偏好。",
        "Collect complaint channels, intake scope, handling authority, response deadlines, policy, history, contract dispute terms, evidence preservation and contact preferences.",
      ],
      [
        "依次登记诉求、核实事实、评估影响、提出处理、升级审批和回访，分别记录客户陈述、证据结论与仍待确认事项。",
        "Register the complaint, verify facts, assess impact, propose handling, escalate approval and follow up, separating claims, findings and unknowns.",
      ],
      [
        "输出投诉处理表、证据清单、审批与沟通记录及回访计划，注明受理时间、责任人、承诺期限、处理结果和客户确认。",
        "Deliver a complaint record, evidence list, approval and communication log and follow-up plan with intake time, owner, deadlines and confirmation.",
      ],
      [
        "未核实指控不能写成事实，赔偿或合同变更不得超越授权；超期、重大影响或无法联系客户时应保留记录并升级。",
        "Do not state unverified allegations as facts or promise unauthorized compensation or changes; record and escalate overdue or high-impact cases.",
      ],
    ),
    detail(
      [
        "收集服务范围、交付清单、质量标准、合同验收方式、客户联系人、已完成记录、验收样本和复核记录、缺陷和例外处理规则。",
        "Collect service scope, deliverable checklist, quality standards, contractual acceptance method, client contacts, completion records, samples, reviews, defects and exceptions.",
      ],
      [
        "按交付物逐项检查数量、版本、质量证据和客户确认，先解决差异或记录例外，再安排签收、后续支持和资料归档。",
        "Check each deliverable's quantity, version, quality evidence and client confirmation; resolve or log exceptions before sign-off, support and archive.",
      ],
      [
        "交付服务验收单、差异与整改台账、客户签收记录及后续支持清单，标明证据位置、整改责任人、期限和复验结果。",
        "Deliver a service acceptance form, variance register, client sign-off and support checklist with evidence, remediation owners, deadlines and retest.",
      ],
      [
        "客户未确认、证据缺失或关键缺陷尚未修复时保持未验收状态；不得用交付邮件发送成功代替客户正式签收。",
        "Keep acceptance open without client confirmation, evidence or critical defect resolution; successful email delivery is not formal sign-off.",
      ],
    ),
    detail(
      [
        "收集工单编号、当前状态、处理记录、待决依赖、上次客户沟通与回复时间、客户联系人、服务等级时限和可披露信息范围。",
        "Collect ticket ID, status, handling history, open dependencies, latest client communication, contacts, service-level deadlines and disclosure scope.",
      ],
      [
        "交接前核对问题、已执行动作、下一步和剩余时限，由接收人确认理解和接手时间，对无人接收的事项执行升级。",
        "Reconcile the issue, actions taken, next step and remaining time before transfer; require recipient acceptance and escalate unclaimed work.",
      ],
      [
        "输出工单交接清单、接收确认记录和未决依赖表，列出原负责人、新负责人、下一检查时间、客户沟通状态及证据位置。",
        "Deliver a ticket handoff checklist, receipt and dependency table with original and new owners, next check, client communication and evidence.",
      ],
      [
        "敏感资料仅通过批准渠道传递；接收人未确认或服务时限即将到期时原负责人继续跟踪并按规则升级。",
        "Share sensitive information only through approved channels; the original owner follows and escalates until receipt or an imminent deadline is resolved.",
      ],
    ),
    detail(
      [
        "收集采购需求、预算余额、供应商名单、询价记录、采购制度、金额口径、预算责任人的确认记录、审批矩阵和订单交接要求。",
        "Collect procurement needs, budget balance, supplier list, quotations, policy, amount definitions, budget-owner confirmation, approval matrix and order handoff requirements.",
      ],
      [
        "按需求申请、预算核对、供应商询价、授权审批、下单和交接顺序描述步骤，并给出缺少报价或预算不足时的分支。",
        "Sequence request, budget check, supplier quotes, authorization, order and handoff, with branches for missing quotes or insufficient budget.",
      ],
      [
        "交付采购申请单、比价记录、审批清单和订单交接表，注明采购对象、金额口径、证据、责任人和预期到货日期。",
        "Deliver a purchase request, quote comparison, approvals and order handoff with item, amount definition, evidence, owner and expected delivery.",
      ],
      [
        "阈值和审批权限必须引用实际有效制度，不得拆单绕过授权；预算不足或利益冲突未处理时暂停下单并升级。",
        "Use effective policy thresholds and authority; do not split orders to bypass approval, and pause for budget gaps or unresolved conflicts.",
      ],
    ),
    detail(
      [
        "收集供应商资质、合同、开户及结算资料、准入标准、审批权限、资料核验人的独立确认记录、系统账号申请和信息保护要求。",
        "Collect supplier qualifications, contract, banking and settlement data, admission criteria, approval authority, independent verification, account requests and information protection requirements.",
      ],
      [
        "依次进行身份与资质核验、合同审查、审批、必要账号开通和供应商登记，安排信息变更复核及后续退出。",
        "Sequence identity and qualification checks, contract review, approval, necessary account creation and registration, with change review and exit.",
      ],
      [
        "交付供应商准入检查表、证据索引、审批与账号台账及资料维护日历，记录有效期、责任人、复核结果和共享范围。",
        "Deliver supplier admission checks, evidence index, approval and account register and maintenance calendar with expiry, owners, review and sharing scope.",
      ],
      [
        "资质过期、账户信息未经独立复核或合同未批准时不得启用；个人和结算信息只在授权范围处理并限制访问。",
        "Do not activate with expired credentials, unverified account details or unapproved contract; restrict personal and settlement data to authorized use.",
      ],
    ),
    detail(
      [
        "收集数据来源、指标定义、统计期间、提取记录、负责人、复核人、指标变更与历史修订记录、发布日期和允许接收报告的对象名单。",
        "Collect data sources, metric definitions, reporting period, extracts, owners, reviewers, metric changes and revisions, publication date and authorized recipients.",
      ],
      [
        "按提取、口径核对、去重、汇总、异常解释、复核和分发排序，对缺失或相互矛盾的数据保留标识并请求源头确认。",
        "Sequence extraction, definition checks, deduplication, aggregation, variance explanation, review and distribution, flagging missing or conflicting data.",
      ],
      [
        "输出报告制作清单、指标来源表、版本与复核记录及分发台账，列明截止时间、计算口径、异常责任人和发布状态。",
        "Deliver a reporting checklist, metric source table, version and review log and distribution register with cutoff, definitions, owners and status.",
      ],
      [
        "未经复核的数据不得发布，口径或期间不一致时暂停汇总；报告不得超出授权名单分发，修订版本须保留原记录。",
        "Do not publish unreviewed data or aggregate mismatched periods and definitions; restrict recipients and retain the original when revising.",
      ],
    ),
    detail(
      [
        "收集文档类别、命名规则、审批要求、保留期限依据、存储位置、诉讼保全与冻结记录、档案保管责任人、访问权限和到期处置及检索流程。",
        "Collect document categories, naming rules, approvals, retention authority, storage, legal holds, custodians, access permissions and expiry and retrieval process.",
      ],
      [
        "按分类、命名、内容复核、授权归档、索引和检索编排操作，单独列出更正、借阅、到期冻结及批准删除分支。",
        "Sequence classification, naming, review, authorized archive, indexing and retrieval, with branches for correction, access, holds and approved deletion.",
      ],
      [
        "交付归档操作表、目录索引、权限核对单和到期处置台账，注明版本、保管责任人、保留依据、复核日期及处置证明。",
        "Deliver an archival procedure, index, access checklist and expiry register with version, custodian, retention basis, review date and disposition evidence.",
      ],
      [
        "保留期限不明、有诉讼保全或删除授权不足时不得销毁；敏感文件只向授权对象开放，检索记录按实际制度留存。",
        "Do not destroy records when retention, legal holds or deletion authority are unclear; restrict sensitive access and retain retrieval logs under policy.",
      ],
    ),
  ],
};
