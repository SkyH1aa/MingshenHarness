import type { CreativeTranslation } from "./creative-template-authoring";

export const OFFICE_PROCEDURES_2: Readonly<Record<string, readonly CreativeTranslation[]>> = {
  "procurement-tender": [
    [
      "先按需求行匹配供应商的规格、数量与交货地点，将单价、运输、安装和服务费用换算到相同范围；不一致项目单列技术确认，展示原始报价和可比总成本，缺项不能按零计入总价。",
      "Match each bid to the requested specification, quantity and delivery location. Normalize unit, freight, installation and service costs to the same scope; refer mismatches for technical review, show original bids and comparable totals, and do not include missing costs as zero in the total.",
    ],
    [
      "按问题编号保留提问、经确认的答复、澄清文件版本和发出时间，逐一核对相关供应商的接收记录；对临近截止仍未答复的问题列出责任人及期限，重大变更交评审方决定是否调整日程。",
      "Keep each question with its confirmed answer, clarification version and issue time, then check receipt by each relevant supplier. Assign owners and deadlines to outstanding questions near the cutoff; refer material changes to the evaluation team for schedule decisions.",
    ],
    [
      "将每项强制资格对应到证照、有效期和核验来源，按招标规定的时点检查过期、关联关系与回避声明；缺少材料标待核验并交责任人补证，保留复核记录，不由表格自动判定资格结果。",
      "Map each mandatory requirement to its license, validity and verification source; check expiry, affiliations and conflict declarations at the specified tender date. Mark absent evidence pending, request follow-up and retain review records without letting the sheet automatically determine eligibility.",
    ],
    [
      "固定经批准的评分细则和权重版本，分别录入各评委对技术、商务与服务的原始分数及理由，检查权重合计和分数范围；给出一条加权复算样例，对显著分歧保留评审说明而非擅自平分。",
      "Fix the approved criteria and weight version; record each evaluator's technical, commercial and service scores with reasons. Check weight totals and ranges, provide one reproducible weighted calculation, and retain explanations for material disagreements instead of silently averaging them away.",
    ],
    [
      "逐条对照招标文件与供应商回复，摘录付款节点、交期、保修及责任上限的原文和偏差；说明可能影响、谈判负责人及法务待核事项，保留各轮条款版本，未经确认不将建议条款标为接受。",
      "Compare the tender and supplier response clause by clause, quoting deviations in payment, delivery, warranty and liability limits. Record potential impact, negotiator and legal-review questions, retain each version, and do not mark proposed terms accepted without confirmation.",
    ],
    [
      "保留报价原币与计量单位，按注明日期的汇率、税率和数量阶梯展示换算过程；分别列必选费用、可选服务及缺失项目，对同一交付范围形成可比总价，汇率或报价版本未确认时暂停结论。",
      "Preserve quoted currencies and units, showing conversions using dated exchange rates, tax rates and quantity tiers. Separate mandatory costs, optional services and missing items to compare equal delivery scopes; defer conclusions when rates or bid versions are unconfirmed.",
    ],
    [
      "按谈判轮次记录与会人、议题、供应商报价版本及双方立场变化，分别列出已确认、附条件同意和待决事项；为每项待办指定负责人、回复日期及佐证，明确纪要需双方确认且不代替合同签署。",
      "Record participants, agenda, supplier quote version and changed positions for each negotiation round. Separate confirmed, conditional and open points; assign owners, reply dates and evidence, and state that minutes need confirmation and do not replace a signed contract.",
    ],
    [
      "核对供应商登记主体、证照有效期、履约能力和可能关联关系，逐项记录公开或获授权资料的来源及查询日期；对无法取得的财务或诉讼信息标未知，列出需进一步核验的风险及负责部门。",
      "Check the registered entity, license validity, delivery capacity and possible affiliations using public or authorized evidence, recording sources and review dates. Mark unavailable financial or litigation information unknown and assign follow-up risks to responsible teams.",
    ],
    [
      "按评标时间线关联评委名单、回避声明、各版评分、会议纪要及补充澄清，保留修改原因和签署状态；核对缺席或未签字记录并列为待完成，输出证据索引和建议访问范围供管理员设置。",
      "Link evaluator lists, recusals, score versions, minutes and clarifications in an evaluation timeline, preserving change reasons and signature status. Flag absences and unsigned records as incomplete; provide an evidence index and proposed access scope for an administrator to configure.",
    ],
    [
      "将推荐供应商与备选方案对应到资格、评分、商务偏差和预算依据，列出建议金额及适用授权层级；记录提交、退回和实际签核日期，审批未完成时只显示推荐状态，不提前发出中标承诺。",
      "Link the recommended supplier and alternatives to eligibility, scoring, commercial deviations and budget evidence, with proposed amount and authority level. Record submission, return and actual sign-off dates; keep the status recommended until approval and do not promise an award early.",
    ],
    [
      "按合同与订单行建立分批交付计划，关联约定数量、地点、计划日期、实际到货和验收材料；把付款条件映射到具体验收节点，缺少签收或审批时标待核，并列责任人和下一次跟进时间。",
      "Build a staged delivery schedule by contract and order line, linking quantities, locations, planned dates, actual receipts and acceptance evidence. Map payment conditions to acceptance milestones; mark missing receipts or approvals pending and assign follow-up owners and dates.",
    ],
    [
      "按采购编号登记流标、单一来源、超预算等异常，关联触发事实、适用规则和受影响环节；比较重新招标、补充询价等可行路径，记录例外审批和关闭证据，紧急情况也不得跳过授权。",
      "Log failed tenders, sole-source requests and budget overruns by procurement ID, linking trigger facts, applicable rules and affected steps. Compare viable paths such as retendering or additional quotes, and record exception approval and closure evidence even when urgent.",
    ],
  ],
  "supplier-scorecard": [
    [
      "以订单行为单位匹配已批准的承诺日和各次实收到货，明确按订单行还是数量计算准时率；分开展示部分交付、已批准改期及迟交原因，抽查分子与分母，缺少有效日期的记录不强行评分。",
      "Match each order line's approved promise date to actual partial receipts, defining whether on-time rate uses lines or quantities. Separate partial deliveries, approved date changes and delay causes; sample numerator and denominator and do not force a score for missing valid dates.",
    ],
    [
      "按供应商和验收批次关联抽检数量、判定标准、不良件及缺陷类型，核对一件多种缺陷是否重复计数；分开呈现严重缺陷和批次处置，样本不足或仅有抽检数据时说明不能代表全量。",
      "Link inspected quantities, criteria, defective items and defect categories by supplier and receipt lot; check whether multiple defects on one item are double-counted. Show severe defects and lot disposition separately and explain when sampling cannot represent the full population.",
    ],
    [
      "按工单优先级匹配对应服务等级、受理时间、首次响应和解决时间，依合同工作日历及已批准暂停记录计算时效；逐条列出超时与未关闭工单，缺少时间戳或等级约定时保留待核状态。",
      "Match each ticket priority to its service level, intake, first response and resolution timestamps. Calculate elapsed time using contractual business hours and approved pauses; list breaches and open tickets, leaving missing timestamps or service-level terms unresolved.",
    ],
    [
      "为每项问题关联临时遏制、根因分析、永久措施、责任人及期限，记录措施完成后的抽检或运行观察证据；由指定复核人确认效果后才标关闭，复发或效果不足的事项继续跟踪并设置复查日期。",
      "Link each issue to containment, root-cause analysis, permanent actions, owners and deadlines, then record inspection or observation evidence after implementation. Close only after the designated reviewer confirms effectiveness; keep recurring or ineffective actions open for recheck.",
    ],
    [
      "逐项核验质量、交付、成本和服务指标的适用类别、权重及生效日期，检查各类别权重合计；对缺失指标先记录批准的处理规则，以同一组样本比较新旧权重影响，变更须留下授权记录。",
      "Verify the category, weight and effective date of each quality, delivery, cost and service metric, checking totals by category. Record approved missing-metric rules, compare old and new weights on the same samples, and retain authorization for changes.",
    ],
    [
      "按季度汇总有效订单、质量批次和服务样本，关联上一期评级及整改完成证据；对指标定义、供应商范围或权重有变化的项目先标注不可直接比较，输出待评议趋势和下季度责任行动。",
      "Summarize valid orders, quality lots and service samples for the quarter, linking prior ratings and corrective-action evidence. Flag metrics as not directly comparable when definitions, supplier scope or weights change, and prepare trends and next-quarter actions for review.",
    ],
    [
      "按产品与周期核对供应商申报产能、可用工时、已承诺订单和实际交付，把瓶颈工序与维护停机单列；测算高峰缺口并比较加班、分批或备选来源的条件，未经核实的产能保留申报标识。",
      "By product and period, compare supplier-reported capacity, available hours, committed orders and actual deliveries, showing bottlenecks and maintenance downtime. Estimate peak gaps and conditions for overtime, staging or alternatives; label unverified capacity as reported.",
    ],
    [
      "以关键物料统计单一供应商的采购占比，核对现有库存、交期、替代物料及已认证供方；按中断影响和切换准备时间列优先级，记录样品验证与升级责任，未认证候选方不当成现成备援。",
      "Calculate single-supplier purchase share for critical materials, checking stock, lead times, substitute materials and qualified suppliers. Prioritize by disruption impact and switch time, assign qualification and escalation tasks, and do not count unqualified candidates as ready backup.",
    ],
    [
      "选取同规格、同数量阶梯和可比交付地点的历史与现行报价，分别列出原币单价、运费、附加费及换算日期；将规格、汇率与供应商价格变化分开解释，对缺少合同依据的差额保留待核。",
      "Compare historical and current bids for the same specification, quantity tier and delivery location, showing original-currency prices, freight, surcharges and conversion dates. Separate specification, exchange-rate and supplier-price effects; flag differences lacking contract evidence.",
    ],
    [
      "将投诉与订单、批次、检验和调查记录关联，区分供应商原因、内部操作及尚待调查的事件；按确认结论汇总影响数量和纠正措施，证据不足时记录责任争议及复核时间，不预先归责。",
      "Link complaints to orders, lots, inspection and investigation records, distinguishing supplier causes, internal handling and pending cases. Summarize affected quantities and corrective actions only against confirmed findings; record disputed ownership and review dates when evidence is insufficient.",
    ],
    [
      "将生效合同中的交付、服务与质量义务拆成可核查条目，逐项链接订单、验收和服务记录，标明符合、偏差或证据缺失；记录合同约定的补救期限并转交法务，避免自行认定违约或虚构罚款。",
      "Break effective contract obligations for delivery, service and quality into verifiable items, linking orders, acceptance and service records. Mark each supported, deviating or missing evidence; record contractual remedy dates for legal review without declaring breach or inventing penalties.",
    ],
    [
      "对持续整改、暂停采购和切换供应商分别列出绩效证据、现有库存、候选方认证、切换成本及交接依赖；比较断供影响并注明审批负责人，切换验证与授权均完成后才能记录实际退出状态。",
      "For continued remediation, purchasing suspension and supplier transition, compare performance evidence, stock, candidate qualification, switching costs and dependencies. Assess supply interruption and identify approvers; record actual exit only after transition validation and authorization.",
    ],
  ],
  "inventory-control": [
    [
      "按物料和需求周期整理历史消耗，单列断货导致未满足的需求及异常值；采用说明清楚的提前期、波动和服务水平假设计算建议安全量，比较参数变化对结果的影响，样本不足时仅列待确认范围。",
      "Organize historical consumption by item and period, separating unmet demand during stockouts and anomalies. Calculate proposed safety stock from clearly stated lead-time, variability and service assumptions, compare parameter sensitivities and mark weak-sample ranges for confirmation.",
    ],
    [
      "从可用余额中排除冻结及未检数量，按日期加入已确认到货并扣除未来需求，核对已预留数量避免重复扣减；找出首次低于安全线的日期和缺口，单列交期未确认货物及采购跟进责任。",
      "Exclude blocked and uninspected quantities from available stock, then add confirmed arrivals and subtract future demand by date, avoiding double deductions for reserved stock. Identify the first safety-level breach and gap, flag uncertain arrivals and assign procurement follow-up.",
    ],
    [
      "按物料、批次和最近出库日计算无消耗时长，结合现存数量、成本及未来需求区分闲置原因；比较退货、内部调拨和报废建议及限制，逐项保留审批、处置凭证与实际完成状态，不直接改库存。",
      "Calculate inactivity by item, lot and last issue date, considering stock, cost and future demand to distinguish causes. Compare return, transfer and disposal options and restrictions, retaining approval and execution evidence without directly changing inventory.",
    ],
    [
      "以批次和统计日核对到期日、数量及冻结状态，计算剩余天数并按适用规则列出临期和已过期项目；优先安排可用批次的复核或领用建议，缺失效期与受限批次单列，不自动解除冻结。",
      "Check expiry dates, quantities and blocked states by lot and cutoff date; calculate days remaining and identify expiring or expired items under applicable rules. Suggest review or use of eligible lots, while separating unknown expiry and restricted stock without automatically releasing it.",
    ],
    [
      "按选定期间将物料消耗量乘以可追溯单位成本，排序并计算累计金额占比，再按已确认阈值划分管理类别；列出零消耗、成本缺失和并列边界样例，盘点频次作为建议交库存负责人确认。",
      "Multiply period consumption by traceable unit cost, rank items and calculate cumulative value share before applying confirmed class thresholds. List zero-use items, missing costs and boundary ties; submit proposed count frequencies to the inventory owner for approval.",
    ],
    [
      "根据物料风险等级、库位、上次盘点和可用盘点人力安排日历，核对周期内覆盖率和重复安排；对盘点时发生的收发记录冻结或截点方案，差异先复盘并由授权人决定是否调整账面。",
      "Schedule counts using item risk, locations, last count and available staffing, checking coverage and duplicate assignments. Define a movement freeze or cutoff for receipts and issues during counting; recount differences before an authorized owner decides on book adjustments.",
    ],
    [
      "按采购订单行及送货单匹配实收、拒收和已验收数量，统一单位后计算短收与超收，核查分批送货是否重复；将未验收、待补送和需供应商确认的差异分别列示，不提前记入可用库存。",
      "Match actual received, rejected and accepted quantities to purchase-order lines and delivery notes, normalizing units to calculate shortages and overages and check duplicate partial deliveries. Separate unaccepted, pending replacement and supplier-confirmation items from available stock.",
    ],
    [
      "以订单行关联拣货扫描、发运单及实际数量，逐项核对物料、批次和目的地，识别错发、漏发或多发；把取消、补发与退货关联原单以避免重复扣减，未经核实的差错提交仓库负责人复查。",
      "Link order lines to pick scans, shipment documents and quantities; check item, lot and destination for wrong, missing or excess shipments. Link cancellations, replacements and returns to original orders to avoid double deductions, and refer unverified errors to the warehouse owner.",
    ],
    [
      "按库位核算包装件尺寸、堆码方式、当前占用及可用空间，结合承重、通道和物料兼容限制检查可放数量；列出超限位置和调整建议，危险品隔离或实际承重未核实时不得宣布库位合规。",
      "Assess pack dimensions, stacking, occupied and available space by location, combining load limits, aisle clearance and material compatibility. List overcapacity and proposed moves; do not declare hazardous-goods segregation or load compliance without physical verification.",
    ],
    [
      "按运输单或调拨单对应发出、预计到达和实际接收，区分途中、部分收货及逾期未收；以物料和批次核对两端数量，已入库部分从在途计算中扣除，对无匹配接收记录分配核查责任。",
      "Match dispatch, expected arrival and actual receipt by shipment or transfer ID, separating in-transit, partially received and overdue items. Reconcile quantities by item and lot, remove received quantities from transit totals, and assign unmatched receipts for investigation.",
    ],
    [
      "先固定统计期间、消耗成本及平均库存的取值方法，用同口径数据计算周转次数和天数并抽查样例；零消耗且平均库存大于零时次数为零而天数不可计算，平均库存为零或成本缺失时标注不可计算。",
      "Fix the period, consumption-cost and average-inventory methods; calculate turns and days on the same basis and check samples. When consumption is zero but average inventory is positive, turns are zero and days undefined; a zero average or missing cost makes the calculation unavailable.",
    ],
    [
      "按退货授权和原订单关联批次、到货数量、检验结果及去向，把待检、合格、隔离和报废候选分别登记；核对检验及重新上架记录，未完成检验或授权的数量不并入可售库存或标为已报废。",
      "Link return authorization and original orders to lots, receipts, inspection results and disposition, separating pending, accepted, quarantined and disposal candidates. Verify inspection and restocking records; do not mark uninspected or unauthorized stock sellable or disposed.",
    ],
  ],
  "sales-forecast": [
    [
      "以商机编号去重并固定预测快照，按当前阶段匹配已批准概率版本，将金额与概率相乘并按预计签约月汇总；单列缺概率、跨期和已签合同，抽查明细与汇总勾稽，不将加权金额当作实际收入。",
      "Deduplicate opportunity IDs and fix the forecast snapshot, matching current stages to approved probability versions. Multiply amounts by probabilities and aggregate by expected close month; separate missing probabilities, date shifts and signed contracts, and do not treat weighted pipeline as actual revenue.",
    ],
    [
      "按同一进入期间与来源建立线索或商机队列，追踪各阶段实际进入、成交和流失日期，明确观察窗口及转化分母；尚在推进的记录标未完成而非失败，避免拿不同月份截面直接相除。",
      "Build lead or opportunity cohorts by entry period and source, tracking actual stage entry, wins and losses with an explicit observation window and conversion denominator. Mark still-active records incomplete rather than lost; do not divide unrelated monthly snapshots.",
    ],
    [
      "按快照保留商机所属区域与负责人，使用预计签约日期归集未来月份，并按统一币种口径比较目标；单列跨区域转移、缺少归属和签约月变动，核对区域明细合计与总预测一致。",
      "Preserve opportunity region and owner at the snapshot, aggregate expected close dates by month and compare targets on a consistent currency basis. Separate transfers, missing ownership and date shifts, and reconcile regional detail to the total forecast.",
    ],
    [
      "依据已确认的渠道归属规则，将商机编号与直销、合作伙伴及负责人关联；识别共同参与或重复登记的交易，待业务方确认后按规则归集一次，展示各渠道预测、未决归属和对应跟进行动。",
      "Apply confirmed attribution rules to link opportunity IDs with direct sales, partners and owners. Identify jointly worked or duplicated deals and count each once under the approved rule after business confirmation, showing channel forecasts, unresolved attribution and follow-up actions.",
    ],
    [
      "以合同编号列出到期日、当前金额、续约阶段、客户意向及适用概率，核对自动续约条款是否真实生效；区分已签续约与概率预测，按到期月汇总风险和负责人，缺少客户确认时标待核。",
      "List contract expiry, current value, renewal stage, customer intent and applicable probability, verifying whether automatic-renewal terms actually apply. Separate signed renewals from probability forecasts and summarize risks and owners by expiry month, flagging missing customer confirmation.",
    ],
    [
      "按来源和进入时间建立线索队列，结合历史合格率、成交率与成交周期估算未来新客数量；将跨期仍在跟进的线索单列并按客户去重，展示样本量、客单价假设和不足以外推的渠道。",
      "Cohort leads by source and entry date, estimating future new customers from historical qualification, win rates and cycle times. Separate leads still in progress, deduplicate customers and show sample sizes, average-value assumptions and channels too small to extrapolate.",
    ],
    [
      "以客户及合同编号拆分续约基数、增购升级和预计收缩，关联相应商机、金额与预计生效日；先排查与续约预测重复的记录，再计算净扩容量，未确认的增购或降额保留预测状态。",
      "Separate renewal base, upsell and expected contraction by customer and contract, linking opportunities, amounts and expected effective dates. Check overlap with renewal forecasts before calculating net expansion; retain forecast status for unconfirmed increases or reductions.",
    ],
    [
      "从已签订单提取各批次数量、约定交付日期、验收条件和实际进度，按交付月列出计划与未确认依赖；关联订单但不重复汇总签约金额，收入确认另依据适用政策和实际验收判断。",
      "Extract staged quantities, contractual delivery dates, acceptance conditions and actual progress from signed orders, showing plans and unresolved dependencies by delivery month. Link orders without double counting bookings; assess revenue separately under applicable policy and actual acceptance.",
    ],
    [
      "筛选预计季度末签约的商机，逐条记录客户确认、报价有效期、内部审批、签署阻塞和负责人；按可核验依据比较按期与跨期情景，安排跟进日期，未签合同不得提前算入已完成业绩。",
      "Select opportunities expected to close near quarter end and record customer confirmation, quote validity, internal approvals, signing blockers and owners. Compare on-time and delayed scenarios using verifiable evidence, schedule follow-up and do not count unsigned contracts as completed results.",
    ],
    [
      "固定历史预测快照及其对应实际期间，按同一币种和归属规则比较预测与订单，分别计算绝对误差和有定义时的比例偏差；单列延迟签约、取消及实际为零的情况，保留误差原因与来源。",
      "Fix historical forecast snapshots and their matching actual periods, comparing forecasts with orders under consistent currency and attribution rules. Calculate absolute error and percentage bias only where defined; separately explain delayed deals, cancellations and zero actuals with sources.",
    ],
    [
      "按产品与交付月份列出预测数量、价目表版本、折扣和净价，计算各产品预计金额与组合占比；用同口径基准拆分数量、价格和组合变化，退货或替代假设缺失时列为待确认而非自动补零。",
      "List forecast quantities, price-list versions, discounts and net prices by product and delivery month, calculating value and mix shares. Compare volume, price and mix changes to a consistent baseline; flag missing return or substitution assumptions instead of silently using zero.",
    ],
    [
      "按团队和月份估算在岗人数、有效工作日及新人爬坡，结合商机工作量和已确认人均处理能力计算覆盖缺口；展示招聘、分配或目标调整的前提，休假与未经验证的产能假设须明确标注。",
      "Estimate staffed headcount, working days and ramp-up by team and month, comparing opportunity workload with confirmed individual capacity to identify coverage gaps. State conditions for hiring, reassignment or target changes and flag leave and unverified productivity assumptions.",
    ],
  ],
};
