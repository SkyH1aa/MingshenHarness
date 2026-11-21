import type { CreativeTranslation } from "./creative-template-authoring";

export const OFFICE_PROCEDURES_3: Readonly<Record<string, readonly CreativeTranslation[]>> = {
  "project-cost-control": [
    [
      "逐项映射合同范围到工作包与成本科目，将已授权预算、管理储备和未分配金额分栏；以合同总额核对各包合计，保存审批版本，再列出没有归属的工作及需要补批的部分。",
      "Map contract scope to work packages and cost codes, separate authorized budget, reserve and unallocated amounts, reconcile totals to the contract, retain the approved version and list unassigned work or items requiring approval.",
    ],
    [
      "按合同节点逐条关联成果和验收证明，比较本期可结金额、累计已结金额及扣留比例；排查跨期重复申请，并将缺少验收证据或扣款争议的行留给合同负责人确认。",
      "Link each milestone to deliverables and acceptance evidence, compare the current claim with amounts already settled and retention, check duplicate period claims and flag disputed or unsupported rows for the contract owner.",
    ],
    [
      "以员工、日期和项目编码关联工时单及对应时段费率，分角色汇总工作包成本；抽查跨项目工时与原始记录，缺失费率单独列示，不以相邻人员费率替代。",
      "Join timesheets to time-specific rates using employee, date and project code, summarize cost by role and work package, sample cross-project hours against source records and flag missing rates without substituting another person's rate.",
    ],
    [
      "先将总账凭证和已确认应计映射到工作包，再按单据关系识别冲回及正式发票；逐项调节工作包合计与总账余额，列出映射缺失、金额差异和需要会计确认的分录。",
      "Map ledger entries and confirmed accruals to work packages, use document links to identify reversals and invoices, reconcile the package total to the ledger and list missing mappings, differences and entries requiring accounting review.",
    ],
    [
      "逐包汇总已发生金额，并由剩余数量乘以适用费率形成完工估算；把供应商报价和进度依据链接到假设，比较费用上涨与工期延误情景，标明尚未确认的估计。",
      "Sum actual costs by package and estimate completion using remaining quantities and applicable rates; link quotes and schedule evidence to assumptions, compare price and delay scenarios and flag estimates still awaiting confirmation.",
    ],
    [
      "用变更编号关联原范围、拟增减工作包和审批状态，分别计算已批准基线变化与待批预测影响；记录工期及责任变化，核对签字后才将批准项纳入新版本预算。",
      "Link each change ID to original scope, proposed package adjustments and approval state; separate approved baseline changes from pending forecast impacts, record schedule and ownership effects and update the budget version only after approval.",
    ],
    [
      "按订单行对照合同承诺、验收、发票入账和取消记录，计算尚未履行或尚未入账的余额；对部分交付逐项调节原承诺，避免将已确认实际与完整订单重复叠加。",
      "Reconcile each order line with commitments, acceptance, posted invoices and cancellations; calculate the unfulfilled or unposted balance and adjust partially delivered orders to avoid double-counting actuals with the full order.",
    ],
    [
      "将合同服务期与会计期间逐段相交，按已确认服务量及合同费率估算未开票部分；记录预提凭证和下一期冲回，再以实际发票复核差额并交会计负责人确认。",
      "Align contract service periods to accounting periods and estimate uninvoiced work from confirmed service quantities and contract rates; record the accrual and reversal, then reconcile to the later invoice for accounting review.",
    ],
    [
      "依合同逐个列出付款节点、验收条件和付款期限，将验收证明及付款回执链接到对应行；对未达到条件或日期冲突的项目标注待确认，单列已支付和预计支付金额。",
      "List contractual milestones, acceptance conditions and payment deadlines; link acceptance evidence and payment receipts to each row, flag unmet conditions or conflicting dates and separate paid from forecast amounts.",
    ],
    [
      "按相同工作包和期间对齐批准基线、实际与完工预测，拆分范围、数量、单价和进度引起的差异；为重大偏差记录证据、纠正负责人及预计完成日，缺口比例为零基数时不计算。",
      "Align approved baseline, actuals and forecast by work package and period; split scope, quantity, price and schedule drivers, document evidence and corrective owners for material variances and avoid ratios with a zero baseline.",
    ],
    [
      "按付款条款和可证明的预计验收日排列未来现金流，扣除已付款并单列税费与保留金；按周或月汇总资金缺口，将尚待审批的支出与确定到期款分开说明。",
      "Schedule future cash flows from payment terms and supportable acceptance dates, deduct paid amounts, separate taxes and retention, summarize funding gaps by week or month and distinguish pending approval from firm obligations.",
    ],
    [
      "逐一核对最终验收、未结订单、保留金、争议及保函期限，把剩余承诺与总账余额调节；为每项指定保管和处理责任，只有证据齐备且授权确认后才建议关闭。",
      "Reconcile final acceptance, open orders, retention, disputes and guarantee expiries to remaining commitments and ledger balances; assign custodians and recommend closure only when evidence and authorization are complete.",
    ],
  ],
  "powerbi-metric-spec": [
    [
      "逐项记录业务定义、适用对象、计算公式、源字段、单位及时间窗口，建立术语与字段的对应表；对重名或公式变更注明版本、生效日和业务负责人，并准备一条可手算的例子。",
      "Record each metric's business definition, audience, formula, source fields, units and time window; map terminology to fields, version duplicate names or changed formulas and include an example that can be calculated by hand.",
    ],
    [
      "以订单行标识连接折扣、退货和税额，先明确交易日期及币种换算规则，再逐行计算净额；用含部分退货和跨币种的授权样例复算，并单独说明与财务确认收入的差异。",
      "Link discounts, returns and tax to order lines, define transaction dates and currency conversion before calculating net values, hand-check authorized partial-return and multi-currency examples and distinguish recognized revenue.",
    ],
    [
      "先定义有效事件及观察窗口，再按客户键和时区归并事件并去重；构造跨天、重复身份及测试账户的样例，记录排除依据，比较业务确认的预期人数与计算结果。",
      "Define qualifying events and observation windows, then normalize timezone and deduplicate by customer key; test cross-day events, duplicate identities and test accounts against business-approved expected counts.",
    ],
    [
      "逐表写明事实粒度及维表唯一键，标注关系基数、过滤方向与缺失键处理；以重复维度键和未匹配事实行构造验收样例，检查连接前后行数和汇总金额是否意外放大。",
      "Document fact grain and unique dimension keys, relationship cardinality, filter direction and missing-key handling; test duplicate dimension keys and unmatched facts, comparing row counts and totals before and after joins.",
    ],
    [
      "梳理源数据完成时间、依赖顺序、允许延迟和展示时间戳，列出失败通知对象与重试责任；给出跨日及上游迟到的验收情景，并注明这只是规格而非已部署任务。",
      "Document source availability, dependency order, allowed delay and displayed timestamp, including notification and retry owners; specify cross-day and late-source acceptance cases without implying a deployed refresh job.",
    ],
    [
      "按角色、组织或客户范围绘制可见矩阵，说明身份到数据范围的映射、例外审批及到期复核；为允许和拒绝各列一组样例，并要求在实际系统独立验证而非只检查文档。",
      "Map each role to permitted organizational or customer scope, including identity mapping, exception approval and expiry reviews; provide allowed and denied examples and require verification in the actual system.",
    ],
    [
      "列出汇总页起点、目标明细、应传递的筛选字段和返回路径，分别设计单选、多选与空筛选验收步骤；要求检查目标页敏感字段授权，避免把汇总权限直接推及明细。",
      "List summary entry points, detail destinations, filters to pass and return paths; specify single-, multi- and empty-selection checks and require separate authorization checks for sensitive detail fields.",
    ],
    [
      "逐页列出日期、区域和产品筛选器的默认值、作用图表、跨页同步和重置行为；用两个冲突筛选条件设计可复现样例，验证每个图表的预期范围及未同步提示。",
      "Document default date, region and product filters, affected visuals, cross-page synchronization and reset behavior; test two conflicting filters and verify each visual's expected scope and unsynchronized-state notice.",
    ],
    [
      "围绕例会决策先排列核心指标、对比期间和需追问的异常，再配置明细与行动项的阅读顺序；说明数据更新时间及口径，使用不同长度标签和空值样例检查页面可读性。",
      "Organize core metrics, comparison periods and exceptions around meeting decisions, followed by detail and actions; state refresh times and definitions and review readability with long labels and missing values.",
    ],
    [
      "为每项指标记录目标、偏离方向、阈值边界、持续时间和冷却期，区分预警与升级责任；设计等于阈值、短暂波动及数据缺失三个样例，交业务负责人确认触发规则。",
      "Record targets, deviation direction, boundary, duration and cooldown for each metric, separating warning and escalation owners; test exact-boundary, transient and missing-data cases for business approval.",
    ],
    [
      "建立旧新公式及生效日期对照，列出历史数据是否重算、重算窗口和批准记录；选取跨版本期间分别按旧新口径计算，图表上明确标注不可直接比较的区段。",
      "Compare old and new formulas and effective dates, recording historical recalculation scope and approval; calculate a cross-version period both ways and label portions that cannot be directly compared.",
    ],
    [
      "为每个指标准备经授权的正常值、空值、重复行和边界日期输入，逐行写出手算过程及期望结果；记录实际测试环境、结果和失败项，不以少量样例代替全量数据验收。",
      "Prepare authorized normal, null, duplicate and boundary-date inputs for each metric with a row-by-row manual calculation and expected result; record the test environment and failures without claiming full-data validation.",
    ],
  ],
  "access-data-register": [
    [
      "在字段字典中分别定义客户主键和联系人外键，保留同一客户多名联系人的示例；以名称相近但编号不同的记录验证去重规则，联系方式仅收集完成业务所必需的字段。",
      "Define customer primary keys and contact foreign keys in the field dictionary, illustrate multiple contacts per customer, test similar names with different IDs and collect only contact fields necessary for the work.",
    ],
    [
      "设计合同主记录、相对方及版本表的关联字段，分别定义签署状态、生效日、到期日和币种；用同一合同多次修订与缺少币种的样例检查导入映射和待核验状态。",
      "Specify links among contract records, counterparties and versions, including signature state, effective and expiry dates and currency; test multiple amendments and missing-currency rows in the import mapping.",
    ],
    [
      "按资产编号建立主档，另以领用记录保存人员、部门及起止日期；构造归还和再次领用样例检查时间重叠，重复编号或缺少责任人的记录进入待核对清单。",
      "Define an asset master by asset ID and separate custody records for people, departments and dates; test return and reassignment for overlapping periods and flag duplicate IDs or missing custodians.",
    ],
    [
      "区分工单主记录和按时间追加的处理事件，设计处理团队、状态及转派前后责任字段；用多次转派和重开样例核对事件顺序，确保导入更新不会覆盖历史节点。",
      "Separate ticket records from append-only handling events, including team, state and handoff ownership; test repeated transfers and reopening to ensure imports retain the event sequence.",
    ],
    [
      "定义物料、仓库、库位与批次的组合粒度及数量单位，分别保存有效期和盘点日期；使用相同批号但不同物料、同物料不同库位的样例验证组合键不会错误合并。",
      "Define the combined item, warehouse, location and lot grain, units, expiry and count dates; test identical lot numbers for different items and different locations for the same item without merging them.",
    ],
    [
      "将供应商主档与多条资质记录分开，说明证照类型、编号、有效期和核验状态；用过期、缺失及一商多证样例检查导入规则，临近到期提示仅作为复核线索。",
      "Separate supplier masters from multiple credential records, specifying document type, ID, expiry and verification state; test expired, missing and multiple credentials and treat expiry alerts as review cues only.",
    ],
    [
      "分别定义课程、员工和参加记录的键以及报名、完成、取消状态；用同一员工多次参加及缺失完成证据的样例验证唯一性，说明员工标识的访问与保留范围。",
      "Define course, employee and attendance keys and registration, completion and cancellation states; test repeat attendance and missing completion evidence and specify access and retention for employee IDs.",
    ],
    [
      "建立会议主键与行动项外键，记录每项负责人、期限、状态及完成证据；检查同场会议的多个行动项和缺少会议主记录的情况，将孤儿行隔离供人工补全。",
      "Link meeting primary keys to action-item foreign keys with owners, deadlines, states and completion evidence; test multiple actions per meeting and quarantine orphan rows for manual correction.",
    ],
    [
      "区分问题主记录、多个整改措施和独立复验记录，定义责任、状态及关闭条件；用措施完成但复验失败的样例检查状态迁移，保留历次复验结果和未关闭原因。",
      "Separate issues, multiple corrective actions and independent verification records, defining ownership, states and closure rules; test completed actions with failed verification and retain the review history.",
    ],
    [
      "按报销单号关联多张票据，票据编号以文本保存前导零并区分原票与红冲关系；用重复号码、不同币种和部分冲销样例检查金额映射，将异常留给财务核对。",
      "Link expense claims to multiple receipts, retain leading zeros as text and distinguish originals from reversals; test duplicate numbers, currencies and partial reversals for finance review.",
    ],
    [
      "设计项目、里程碑及节点依赖的关联表，分别记录计划和实际日期；用跨项目依赖、缺失项目和循环依赖样例检查导入，异常关系先列待处理而非自动改期。",
      "Specify project, milestone and dependency relationships with separate planned and actual dates; test cross-project dependencies, missing projects and cycles, flagging anomalies rather than silently rescheduling.",
    ],
    [
      "以人员、资源和权限类型定义授权记录，附审批依据、生效日、失效日及复核人；用过期授权和同一资源多角色样例检查台账筛选，实际撤权须由责任系统另行确认。",
      "Define grants by person, resource and permission type with approval evidence, effective and expiry dates and reviewers; test expired grants and multiple roles while requiring separate confirmation of actual revocation.",
    ],
  ],
  "service-operations": [
    [
      "先按问题类别和影响确定优先级，再对照技能组、服务时段和当班负荷分配队列；信息不完整的请求标为待澄清，涉及安全或重大中断的事项按既定值班链升级。",
      "Set priority by request type and impact, then assign by skill group, service hours and on-duty load; mark incomplete requests for clarification and escalate security or major outages through the agreed chain.",
    ],
    [
      "明确受理起点、有效响应定义及服务日历，逐单扣除约定的不计时段并计算首响时长；比较不同等级的约定时限，列出超时样本与自动回执是否计入的依据。",
      "Define receipt, effective response and service calendar, subtract agreed excluded periods and calculate first-response time per ticket; compare service-level limits and document whether automatic acknowledgments count.",
    ],
    [
      "按事件时间线计算受理至解决的有效时长，单列暂停、恢复及重开次数；按优先级给出中位数和高分位数，并抽查超时工单的等待原因及适用计时规则。",
      "Calculate effective resolution time from event timelines, separating pauses, resumptions and reopenings; report median and high percentiles by priority and sample breach reasons and applicable clock rules.",
    ],
    [
      "按当前未结状态、账龄、客户影响和阻塞依赖给工单分层，将高风险项安排到近期批次；为每批指定处理容量、负责人和复查日，无法处理的项目注明下一步。",
      "Segment open tickets by age, customer impact and dependencies, schedule high-risk items first and assign batch capacity, owners and review dates; document next steps for blocked cases.",
    ],
    [
      "按投诉编号记录客户原话、现有证据、影响范围和答复时限，区分事实与待核指控；串起升级、接手和反馈时间，列出承诺到期但仍无责任人的事项。",
      "Record customer statements, evidence, impact and reply deadlines per complaint, distinguishing facts from allegations; link escalation, acceptance and response times and flag promises without an owner.",
    ],
    [
      "按时段整理历史来单量与技能需求，扣除休假、培训和不可用时间后估计可用覆盖；标出高峰缺口和候补安排，未经确认的加班或替班不得视为已落实。",
      "Compare historical arrival volume and skill needs by interval with staffing after leave, training and unavailable time; identify peak gaps and backups without treating unconfirmed overtime or substitutions as secured.",
    ],
    [
      "将高频工单主题与搜索无结果、低评分或过期知识条目关联，核对是否存在可公开的解决依据；按影响和复用率排序候选文章，指定作者及技术复审日期。",
      "Link frequent ticket topics to failed searches, low-rated or outdated articles and verify releasable resolution evidence; prioritize candidate articles by impact and reuse, assigning an author and technical review date.",
    ],
    [
      "先固定抽样期间、总体和评分标准，再按约定方法抽取工单并保留样本编号；由复核人逐项记录得分依据和缺陷，披露未抽中范围，安排争议复评和整改期限。",
      "Fix the sampling period, population and scorecard, select tickets using the agreed method and retain sample IDs; record evidence and defects per item, disclose unsampled scope and schedule disputed-score review.",
    ],
    [
      "依据客户、问题特征和约定时间窗关联多次联系，人工复核不同问题被误连的候选；先固定重复联系率的分母与去重规则，再列出可追溯的关联例子和主要原因。",
      "Link contacts using customer, issue features and an agreed time window, reviewing possible false matches; define the repeat-contact denominator and deduplication rules before reporting traceable examples and causes.",
    ],
    [
      "逐单记录升级发起、接收确认、承诺时限和处置完成时间，分别计算接手超时与处理超时；对无接收确认的工单展示原责任链和下一次催办负责人。",
      "Record escalation, acceptance, promised deadline and resolution timestamps, calculating acceptance and handling breaches separately; show the existing ownership chain and next follow-up owner for unaccepted tickets.",
    ],
    [
      "关联已解决工单并记录约定回访时间、联系结果及客户授权可保存的原话；将未联系、无回复和明确反馈分别统计，对需要再处理的意见创建负责人及跟进日期。",
      "Link resolved tickets to scheduled follow-up, contact outcomes and customer statements authorized for retention; count unreachable, no-response and explicit feedback separately, assigning owners to actionable items.",
    ],
    [
      "统一统计窗口和工单状态，按来单、解决、积压及各等级时效汇总本月和上月；解释可证实的变化原因，标出数据截止时间，并为重点问题记录行动责任和复查节点。",
      "Align reporting windows and ticket states, summarize arrivals, resolutions, backlog and service levels against the prior month; explain evidenced drivers, label the cut-off and assign owners and review dates to key issues.",
    ],
  ],
};
