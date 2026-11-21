import type { CreativeTranslation } from "./creative-template-authoring";

export const OFFICE_PROCEDURES_1: Readonly<Record<string, readonly CreativeTranslation[]>> = {
  "expense-reimbursement": [
    [
      "先按申请人与出行日期核对行程和城市标准，将机票、住宿、交通分别列预算，再对照所属成本中心余额，标识超限原因及负责审批人。预算不足或政策版本不明时列待确认，不把送审当成预订。",
      "Match the itinerary to the traveler, dates and destination policy; itemize airfare, lodging and transport, then compare the cost-center balance. Identify exceptions and approvers; leave unclear policy or funding pending rather than treating submission as a booking.",
    ],
    [
      "以原票号串联购票、每次改签、退款回执和最终行程，分开列原付款、差价及手续费，并核对每笔退款的到账日期。将未退金额与已报销记录逐笔匹配，跨期退款列入后续跟踪。",
      "Link the original ticket to each change, refund receipt and final itinerary. Separate the original payment, fare differences and fees; match refunds to reimbursement records and track amounts still outstanding or received in a later period.",
    ],
    [
      "按入住日期逐晚匹配目的地城市等级、员工职级和当日有效的住宿上限，分别计算合住后个人负担及超额。对会议旺季等例外核对书面审批范围，未获确认的部分单独显示待审金额。",
      "Match each night to the destination tier, employee grade and policy limit effective on that date. Calculate each traveler's share and excess, then check written approval for exceptions; show unconfirmed amounts as pending review.",
    ],
    [
      "根据出差起止时间生成逐日明细，依公司规则判断首尾日和免费接驳是否计补贴，再将出租车或公共交通票据关联对应日期。存在重复待遇或行程凭证缺失时暂停计算该日并记录原因。",
      "Build a daily itinerary and apply company rules for partial travel days and free transfers. Link taxi or transit receipts by date; pause the affected day's calculation when benefits may overlap or travel evidence is missing.",
    ],
    [
      "将每次用餐按日期、餐次及参与人对应差旅日历，标记已由酒店、会议或公司提供的餐食；对客户招待另列事由和费用承担部门。依据有效政策扣减个人补贴，并避免公开不必要的人员信息。",
      "Map meals by date, meal and participant to the travel calendar, flagging meals provided by the hotel, event or company. Record client entertainment and its cost owner separately; apply policy deductions and minimize personal details.",
    ],
    [
      "先按币种列出原始票据与付款日，再按已确认政策选择实际卡账汇率或指定记账汇率，逐笔保留汇率来源及换算结果。将手续费和汇差与消费本金分开，缺汇率的币种不纳入折算合计。",
      "List receipts by original currency and payment date. Apply the approved card or accounting exchange rate, retain its source and each conversion, and separate fees and exchange differences; exclude currencies without a confirmed rate from the converted total.",
    ],
    [
      "按员工与预借编号汇总可用借款，剔除此前已冲销的部分，再以核准报销额抵减并计算正向补款或负向应退。附原借款、报销和历史冲销索引，余额方向或责任人不清时不生成付款指令。",
      "Group outstanding advances by employee and advance ID, exclude amounts previously settled, then offset approved expenses to determine reimbursement or repayment. Link source records and do not issue payment instructions when balance direction or ownership is unclear.",
    ],
    [
      "按票种及代码号码筛选跨批次重复，再比较金额、日期、提交人和红字冲销或重开关系，形成候选组而非直接定性。保留每张票据及审核记录的来源，交人工确认后再决定后续处理。",
      "Screen across batches by document type and invoice identifiers, then compare amount, date, submitter and credit-note or reissue links. Preserve the evidence as candidate groups for human review instead of automatically judging misconduct.",
    ],
    [
      "逐项登记无法取得票据的业务原因、金额和应补期限，对照现行制度列明允许的替代材料及有权审批人；为每项设置跟进状态。材料或批准未齐时保持待补，不能虚构票据或宣告合规通过。",
      "Register the business reason, amount and deadline for each missing receipt; check current policy for acceptable substitute evidence and authorized approvers. Track each item as pending until evidence and approval are actually available.",
    ],
    [
      "筛选关账日前已完成但尚未报销的行程，核对是否已有付款或预提凭证，再依据已知支出和合理估计测算金额。列出会计期间、反向冲回日期及下期实际报销差额，避免重复计提。",
      "Identify trips completed before close but not yet reimbursed, checking existing payment and accrual entries first. Estimate from known expenses, then record the accounting period, reversal date and difference to the later reimbursement to prevent double accrual.",
    ],
    [
      "按共同票据列明参与人员、受益成本中心及经确认的分摊依据，计算每人的份额并处理舍入差额，使合计与原票一致。缺少比例、人员或授权时保留未分配额，不替用户决定分摊规则。",
      "For each shared receipt, record participants, benefiting cost centers and the agreed allocation basis. Calculate shares and rounding so the total matches the receipt; retain an unallocated balance when people, ratios or authorization are missing.",
    ],
    [
      "以付款批次和脱敏收款人标识连接核准清单与银行回执，区分已支付、失败、退回及无回执记录，核对批次总额。对失败项记录原因和重付审批，确认原款状态后才列入候选重付清单。",
      "Join the approved list and bank acknowledgments by batch and masked payee identifier. Reconcile totals across paid, failed, returned and unconfirmed items; record failure reasons and approvals before proposing any repayment after the original status is confirmed.",
    ],
  ],
  "cashflow-treasury": [
    [
      "分别按账户和币种核对银行期末余额与总账，再列在途转账、未达存款及未入账手续费形成调节表；每项记录发生日和责任人。两端转账尚未确认时只列在途，不把同一笔资金重复计入可用头寸。",
      "Reconcile each bank account and currency to the general ledger, listing transfers in transit, deposits and unposted fees with dates and owners. Show unsettled transfers as transit rather than counting the same funds as available at both ends.",
    ],
    [
      "将已确认收付按实际预计日期映射至十三个自然周，以期初余额加流入减流出逐周滚动，并与上版比较日期及金额变化。分别标识合同承诺和概率预测，指出最低余额周及尚待确认的缺口。",
      "Map confirmed receipts and payments to thirteen calendar weeks and roll opening cash forward by inflows and outflows. Compare dates and amounts with the prior version, distinguish commitments from estimates and identify the lowest week and unconfirmed gaps.",
    ],
    [
      "按法人分别列出净薪、相关代扣及预计付款账户，结合发薪日与银行批次截止时点倒排资金准备和复核时间；遇节假日标记需确认的提前日期。表中仅使用汇总金额，不放置个人薪酬明细。",
      "List net payroll, related withholdings and funding accounts by legal entity. Work backward from pay dates and bank cutoffs, flag holiday adjustments for confirmation, and use aggregated figures without individual payroll details.",
    ],
    [
      "按法人、税种和属期整理申报截止日、预计金额、缴款账户与资金准备时间，并检查是否已存在同属期付款记录。将未申报的测算与已确认税额分栏，具体日期和政策适用性需由税务负责人确认。",
      "Organize tax deadlines, estimated amounts, payment accounts and funding dates by entity, tax and period; check for existing payments. Separate estimates from filed amounts and ask the tax owner to confirm deadlines and applicability.",
    ],
    [
      "对候选付款逐笔核对合同到期日、发票、验收证据和授权状态，先标出逾期或涉及违约的项目，再在可用现金内提出批次顺序。未满足付款条件的单列待办，排序建议不触发转账。",
      "Check each candidate against contract due dates, invoices, acceptance evidence and authority. Highlight overdue or penalty-sensitive items before proposing batches within available cash; list unmet conditions separately and never initiate a transfer from the ranking.",
    ],
    [
      "按关联号配对调出和调入主体的账户、日期、原币金额及手续费，将尚未到账的一侧列为在途；核对法人间余额后生成合并抵消明细。币种或金额不一致时保留差异，不强制配平。",
      "Pair sending and receiving entities by transfer reference, accounts, dates, original currency, amounts and fees; mark missing receipts as transit. Prepare intercompany elimination details only after balance checks and preserve mismatches for review.",
    ],
    [
      "按授信合同区分总额度、已提款、保函占用和已解除占用，核对循环使用及币种折算条件后测算可用额度；按到期日列续签责任人。未确认的额度条件单列，不能当成银行存款。",
      "Separate facility limits, drawings, guarantee usage and released usage by agreement; check revolving and currency rules before estimating headroom. List renewal owners by maturity and never treat an unconfirmed facility as bank cash.",
    ],
    [
      "逐笔核对定存本金、起息日、到期日、计息方式和提前支取条款，按合同口径估算到期利息并列出到期后的可动用日期。对自动续存设置提醒，实际续存或解约状态以银行凭证为准。",
      "Check each deposit's principal, interest start, maturity, accrual method and early-withdrawal terms. Estimate maturity interest and availability under the contract; flag automatic renewal and use bank evidence for actual renewal or redemption.",
    ],
    [
      "按法人、银行账户和原币汇总余额与近期收付，单列冻结金额及可用部分，再以同一指定日期的汇率计算展示币种总额。保留原币明细和汇率来源，缺少汇率时显示未折算而非默认同值。",
      "Summarize balances and near-term flows by entity, account and original currency, separating restricted and available amounts. Convert using rates from one stated date while retaining source-currency details; mark missing rates as unconverted.",
    ],
    [
      "按交易类型将银行扣费与适用协议费率、计费基数及最低收费逐笔比对，另核对税额、退款和冲回记录。将计算值与实扣差额及所用合同版本列明，协议或计费规则缺失时不认定银行错收。",
      "Compare each bank charge with the applicable agreement, transaction base and minimum fee, including tax, refunds and reversals. Show calculated versus charged amounts and agreement version; do not assert an error when terms are missing.",
    ],
    [
      "建立基准收付日历，再分别推迟关键回款或提前已承诺付款，逐期计算最低可用余额及跌破现金底线的日期；列出延付或融资备选项。每项措施标注依赖条件和未确认状态，不预设一定能执行。",
      "Build a baseline cash calendar, then separately delay key receipts or advance committed payments to identify minimum available cash and breach dates. List deferral or funding options with dependencies and unconfirmed status rather than assuming execution.",
    ],
    [
      "按账户和限制类型登记冻结、保证金或监管资金的原币金额、起止日、解除条件及凭证，核对其是否已计入银行余额；形成总额到可支付余额的调节。解限缺凭证时继续视为受限并提醒复核。",
      "Register frozen funds, deposits and other restrictions by account, currency, dates, release conditions and evidence. Reconcile bank totals to payable cash and retain restricted status until release is supported by evidence.",
    ],
  ],
  "accounts-receivable": [
    [
      "以统计截止日逐张计算发票到期天数，按已批准的区间分别汇总未到期及逾期余额，并将客户贷项和负余额单列。抽查边界日期及分层合计与总账的差异，未确定到期日的发票列待查。",
      "Calculate invoice aging as of the cutoff date and summarize current and overdue balances using approved bands; show credits and negative balances separately. Sample boundary dates, reconcile totals to the ledger and flag invoices lacking due dates.",
    ],
    [
      "先核对未清发票、合同付款条件和已有争议，再按逾期天数及金额列出联系人、拟沟通日期和升级负责人；保存每次联系及回复。对有争议款项先转相关部门核实，不擅自承诺减免或延期。",
      "Verify open invoices, contract terms and disputes, then schedule contacts and escalation by overdue days and amount. Record communications, route disputed amounts for investigation and do not promise concessions or extensions without authority.",
    ],
    [
      "以银行流水、客户及汇款参考号寻找对应发票，按实际到账金额记录一对多或部分收款分配，计算发票剩余和未认领金额。缺少客户确认或凭证的款项保留待认领，不以近似金额强行核销。",
      "Match bank transactions to invoices using customer and remittance references, recording partial or one-to-many allocations and remaining balances. Keep unmatched receipts pending when evidence is insufficient rather than forcing a match by similar amounts.",
    ],
    [
      "固定双方对账区间和截止日，按发票、贷项及收款流水逐笔比较期初、期间发生与期末余额；将时间差、金额差和缺单分组。每项保留证据与回复期限，收到确认前不把对账函状态标为已确认。",
      "Fix a shared reconciliation period and compare opening balances, invoices, credits, receipts and closing balances. Group timing differences, amount mismatches and missing records with evidence and response deadlines; do not mark an unanswered confirmation accepted.",
    ],
    [
      "为每笔争议记录关联发票、客户异议、涉及金额与证据，分别指派质量、商务或交付负责人核查并设置下次反馈日。跟踪处理方案及批准结果，争议解除或冲销前重新核对授权和剩余应收。",
      "Link each dispute to its invoice, customer objection, amount and evidence; assign quality, commercial or delivery owners and a follow-up date. Track proposed resolutions and approvals, rechecking authority and remaining receivables before closure or write-off.",
    ],
    [
      "按客户及法人归集核定额度、未清应收、政策规定占额的未发货订单和有效担保，计算可用空间并检查超限；展示额度到期日与审批链。订单是否占额或担保可用性不明时单列，不擅自放行。",
      "Aggregate approved limits, open receivables, policy-eligible order commitments and valid guarantees by customer and entity. Calculate headroom and show expiry and approval; flag uncertain commitments or guarantees without automatically releasing orders.",
    ],
    [
      "依据合同列出各期到期日和应付金额，将银行到账分配至对应期次并区分部分支付；复核各期合计与合同金额及任何已批准变更。延期未签批、到账未匹配或同笔收款重复使用时标记异常。",
      "List installment due dates and amounts from the contract, allocate actual receipts and distinguish partial payments. Reconcile installments to the contract and approved amendments; flag unsigned extensions, unmatched receipts and duplicate allocations.",
    ],
    [
      "固定测算日和已批准政策，将未清余额按账龄及风险组分类，依适用损失率计算各组准备并汇总；复核单项评估与群组测算是否重复。缺少风险分组或损失率时标为未计算，交财务负责人确认。",
      "Fix the measurement date and approved policy, classify open balances by aging and risk group, and apply applicable loss rates. Check that individual and collective assessments do not overlap; leave missing rates or classifications uncalculated for finance review.",
    ],
    [
      "按客户、法人及合同核对预收余额与拟抵扣发票，检查抵扣授权和此前使用记录，再列出抵扣前后双方余额。若金额超过可用预收或涉及跨主体抵扣，则保留异常并等待有权人员处理。",
      "Check advance balances against proposed invoices by customer, entity and contract, including authorization and previous usage; show before-and-after balances. Flag excess or cross-entity offsets for authorized review rather than applying them automatically.",
    ],
    [
      "保留合同原始账期与原到期日，逐项核对延期申请、书面批准人、生效范围和期限，再计算适用发票的新到期日；记录变更原因。未签批或已过有效期的申请不得覆盖原有账期。",
      "Preserve original contract terms and due dates; check each extension request, written approver, scope and validity before calculating revised invoice dates. Record reasons and do not overwrite original terms for unsigned or expired requests.",
    ],
    [
      "按客户及发票关联每次书面付款承诺与银行到账，标明承诺日、金额、实际到账及尚未兑现部分；约定统计期间和兑现率分母。逾期承诺列出下一联系人与升级日期，不能把客户承诺记为现金。",
      "Link written payment commitments to invoices and bank receipts, showing committed dates and amounts, actual cash and unfulfilled portions. Define the period and fulfillment-rate denominator; assign overdue follow-up without recording promises as cash.",
    ],
    [
      "对接近关账日的收款分别记录付款方指令日、银行实际入账日和公司记账期间，并核对在途款及对应发票；按关账规则列示跨期差异。归属存在争议时交会计复核，不推断收入确认结论。",
      "For receipts near close, record the payer's instruction date, actual bank posting date and accounting period; reconcile transit and invoices. Show cutoff differences under the close policy and refer disputed treatment to accounting without inferring revenue recognition.",
    ],
  ],
  "management-accounting": [
    [
      "统一两期产品范围、退货口径和单位，先计算各期净销售与毛利，再按固定顺序拆分销量、售价、单位成本及组合变化；核对桥接起点终点与残差。标明分解顺序，避免把同一差异重复归因。",
      "Align product scope, returns and units across periods; calculate net sales and gross profit, then bridge volume, price, unit cost and mix in a fixed order. Reconcile endpoints and residuals, and disclose the decomposition order to avoid double attribution.",
    ],
    [
      "先区分直接归属费用与待分摊费用池，按已批准的收入、订单量或工时选择动因，逐渠道计算比例与分配金额；核对汇总是否等于费用池。动因缺失或分母为零时保留未分配余额供复核。",
      "Separate directly attributable expenses from the shared pool and apply approved revenue, order or hour drivers by channel. Reconcile allocations to the pool and retain an unallocated balance when drivers are missing or the denominator is zero.",
    ],
    [
      "将已批准预算版本与实际费用按同一部门、科目和期间映射，列出金额差异及适用的差异率，再由责任人解释重大项目和一次性因素。预算为零或口径变化时单列说明，不制造可比百分比。",
      "Map the approved budget and actuals to consistent departments, accounts and periods; show amount and applicable percentage variances, with owners explaining material and one-off items. Explain zero budgets or changed definitions without fabricating percentages.",
    ],
    [
      "确定订单或客户群及观察期，以净收入扣除履约、渠道等直接变动成本，明确获客支出是否计入该口径；用有效订单数计算单位贡献。退货和样本范围单列，未提供生命周期数据时不推算终身价值。",
      "Define the order or customer cohort and observation period, subtract direct variable costs from net revenue and state whether acquisition spend is included. Calculate contribution per valid order; disclose returns and do not infer lifetime value without data.",
    ],
    [
      "按订单汇总收入、折扣、退款及可归属的运费和佣金，计算净收入减可避免变动成本的贡献额，并与订单来源核对。固定费用如需展示另列，避免将会计分摊误认为取消订单即可节省的支出。",
      "By order, reconcile revenue, discounts, refunds, freight and commissions to source records and calculate net revenue less avoidable variable cost. Show allocated fixed overhead separately rather than implying it disappears when the order is canceled.",
    ],
    [
      "核对同期间固定成本、单位售价及单位变动成本，先计算单位贡献；仅当贡献为正时，以固定成本除以单位贡献并按业务单位向上取整。分别测算价格或成本变动，明确税费与产能假设。",
      "Verify fixed cost, unit price and variable cost for the same period. Only when unit contribution is positive, divide fixed cost by it and round up to a whole business unit; test price or cost changes and disclose tax and capacity assumptions.",
    ],
    [
      "按机台收集可归集成本、正常产能和实际工时，依已批准政策确定分配率及在制品处理；单列停工和未吸收成本。异常高产量须复核费率是否需要调整，再核对分配额与未吸收额的合计。",
      "Collect attributable machine costs, normal capacity and actual hours; apply approved policy to the allocation rate and work in progress. Show downtime and unabsorbed costs separately, review rates for abnormally high output and reconcile the total.",
    ],
    [
      "将立项时批准预算和收益假设与分阶段支出及实际业务指标对应，注明测量窗口、责任人和证据；将已实现效果与预测分栏。对预算外变更及无法归因的收益列待核实，不把估计节约写成到账现金。",
      "Compare approved investment and benefit assumptions with phased spending and actual business indicators, identifying measurement windows, owners and evidence. Separate realized results from forecasts and flag unverified attribution or unapproved scope changes.",
    ],
    [
      "以项目编号、人员角色和工作日期匹配核准工时与当期有效成本率，计算项目人工成本并汇总未分配工时；检查同人同日重复申报及费率缺失。仅向有权限的受众展示必要明细和汇总结果。",
      "Match approved hours to project, role, work date and the effective cost rate, then summarize labor cost and unallocated time. Check duplicate same-day entries and missing rates, limiting personnel detail to authorized audiences.",
    ],
    [
      "统一本期、上期及去年同期的部门和科目映射，计算可比金额、环比与同比，并单列组织调整或一次性费用；对显著波动附原始凭证索引。基期为零或缺失时显示不适用并解释金额变化。",
      "Align department and account mappings for current, prior and prior-year periods; report comparable amounts and changes, separating reorganizations and one-off costs. Link material variances to evidence and mark rates unavailable when the base is zero or missing.",
    ],
    [
      "为每项降本措施记录批准基线、实施时间、责任人及实际成本，将已验证节省与避免未来支出分别计算；追溯凭证并核对跨措施重复认领。扣除实施成本后展示净效果，未经核实的收益保留预测状态。",
      "Record each initiative's approved baseline, timing, owner and implementation cost; calculate verified savings separately from avoided future spending. Trace evidence, eliminate duplicate claims and show net impact while keeping unverified benefits as forecasts.",
    ],
    [
      "从同一结账版本汇总收入、毛利、费用和现金指标，对照批准预算并解释最重要差异；为每项结论附来源、责任人和下次行动。区分利润与现金流及预测与实际，未完成复核的数字明确标识。",
      "Summarize revenue, gross profit, expenses and cash from a consistent close version, compare with approved budget and explain major variances. Attach sources, owners and next actions; distinguish profit from cash and forecasts from actuals, flagging unreviewed figures.",
    ],
  ],
};
