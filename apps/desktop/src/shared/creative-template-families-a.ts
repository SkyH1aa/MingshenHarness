import { OFFICE_PROCEDURES_1 } from "./creative-template-a-procedures-1";
import { OFFICE_PROCEDURES_2 } from "./creative-template-a-procedures-2";
import { OFFICE_PROCEDURES_3 } from "./creative-template-a-procedures-3";
import type { CreativeExtendedFamily, CreativeTranslation } from "./creative-template-authoring";

type Pair = CreativeTranslation;
type ScenarioRow = readonly [Pair, Pair, Pair, Pair, Pair];
type SectionRow = readonly [string, string, string, string, string];

const SCENARIO_PROCEDURES: Readonly<Record<string, readonly Pair[]>> = {
  ...OFFICE_PROCEDURES_1,
  ...OFFICE_PROCEDURES_2,
  ...OFFICE_PROCEDURES_3,
};

function scenarios(
  familyId: string,
  audience: Pair,
  _context: { focus: Pair; inputs: Pair; output: Pair; risk: Pair },
  rows: readonly ScenarioRow[],
): CreativeExtendedFamily["scenarios"] {
  const procedures = SCENARIO_PROCEDURES[familyId];
  if (!procedures || procedures.length !== rows.length)
    throw new Error(`Missing creative scenario procedures for ${familyId}`);
  return rows.map(([name, focus, inputs, output, risk], index) => {
    const procedure = procedures[index];
    if (!procedure)
      throw new Error(`Missing creative scenario procedure for ${familyId}: ${index}`);
    return {
      name,
      audience,
      brief: { focus, output, risk },
      focus: [`${focus[0]}${procedure[0]}`, `${focus[1]} ${procedure[1]}`],
      inputs,
      output,
      risk,
    };
  });
}

function sections(rows: readonly SectionRow[]): CreativeExtendedFamily["sections"] {
  return rows;
}

function officeFamily(input: {
  id: string;
  name: Pair;
  category: CreativeExtendedFamily["category"];
  format: CreativeExtendedFamily["format"];
  summary: Pair;
  headings: readonly Pair[];
  playbook: CreativeExtendedFamily["playbook"];
  audience: Pair;
  context: { focus: Pair; inputs: Pair; output: Pair; risk: Pair };
  rows: readonly ScenarioRow[];
}): CreativeExtendedFamily {
  return {
    id: input.id,
    name: input.name,
    category: input.category,
    format: input.format,
    summary: input.summary,
    style: ["专业、清晰、便于复核和持续维护", "Professional, clear, reviewable, and maintainable"],
    sections: input.headings.map(([zh, en], index) => [
      `area-${index + 1}`,
      zh,
      en,
      `围绕${zh}写明适用范围、来源证据、处理结果和待确认事项。`,
      `For ${en.toLowerCase()}, document scope, source evidence, results and unresolved items.`,
    ]),
    acceptance: [
      input.context.output,
      input.context.risk,
      [
        "交付内容标明数据来源、适用期间及未验证边界。",
        "Identify data sources, applicable period and verification limits.",
      ],
    ],
    workflow: [
      ["先核对资料来源、适用范围和统计粒度。", "Confirm sources, scope and data grain first."],
      [
        "整理输入、政策与业务假设并保留证据。",
        "Organize inputs, policy and assumptions with evidence.",
      ],
      [
        "按场景计算或编制处理结果，并记录例外。",
        "Calculate or prepare scenario-specific results and record exceptions.",
      ],
      [
        "复核关键数值、责任和交付物的实际验证状态。",
        "Review critical values, ownership and actual verification status.",
      ],
    ],
    playbook: input.playbook,
    scenarios: scenarios(input.id, input.audience, input.context, input.rows),
  };
}

export const EXTENDED_CREATIVE_FAMILIES_A: readonly CreativeExtendedFamily[] = [
  {
    id: "expense-reimbursement",
    name: ["报销与差旅", "Expense and travel reimbursement"],
    category: "spreadsheet",
    format: "XLSX",
    summary: [
      "围绕票据、政策、预借与支付完成可追溯的差旅报销",
      "Reconcile travel expenses to receipts, policy, advances, and payment evidence",
    ],
    style: ["清晰、审慎、适合财务复核", "Clear, prudent, and ready for finance review"],
    sections: sections([
      [
        "scope",
        "报销范围",
        "Expense scope",
        "明确人员、行程、期间和适用政策版本。",
        "Identify travelers, trips, periods, and applicable policy versions.",
      ],
      [
        "evidence",
        "票据与审批",
        "Receipts and approvals",
        "保留票据键、审批编号、币种及原始凭证来源。",
        "Retain receipt keys, approvals, currency, and source evidence.",
      ],
      [
        "rules",
        "政策与换算",
        "Policy and conversion",
        "列明限额、补贴、汇率和例外的有效日期。",
        "Document effective limits, allowances, rates, and exceptions.",
      ],
      [
        "calculation",
        "应报与冲销",
        "Claim and advance settlement",
        "分别计算公司支付、个人垫付和预借款冲销。",
        "Calculate company-paid, employee-paid, and advance settlement separately.",
      ],
      [
        "exceptions",
        "异常复核",
        "Exception review",
        "记录重复、超标、缺票及对应责任人。",
        "Record duplicates, excesses, missing evidence, and owners.",
      ],
      [
        "payment",
        "付款与核对",
        "Payment reconciliation",
        "按审批批次核对应付、实付与退回状态。",
        "Reconcile approved, paid, and returned amounts by batch.",
      ],
    ]),
    acceptance: [
      [
        "费用明细与对应分摊额、应报余额与冲销及付款分别逐笔勾稽。",
        "Reconcile expenses to allocations and reconcile amounts due to settlements and payments separately.",
      ],
      [
        "政策例外仅标记待批准，不自动认定合规或付款。",
        "Flag policy exceptions for approval without implying compliance or payment.",
      ],
      [
        "原币、汇率和个人敏感信息均按授权处理。",
        "Handle original currency, rates, and personal data under appropriate authorization.",
      ],
    ],
    workflow: [
      [
        "收集行程、票据、政策和付款凭据。",
        "Collect itineraries, receipts, policy, and payment evidence.",
      ],
      [
        "确认明细粒度、适用标准和有效日期。",
        "Confirm line-item grain, applicable rules, and effective dates.",
      ],
      [
        "按票据核算并记录例外及审批。",
        "Calculate each receipt and record exceptions and approvals.",
      ],
      ["复核汇总、冲销及实际付款状态。", "Review totals, settlements, and actual payment status."],
    ],
    playbook: {
      inputs: [
        "收集员工编号、出差起止与地点、费用明细、票据代码号码、税额、币种、成本中心、预借款、审批记录和付款回执，并记录发生日、政策版本与汇率来源。缺失票据或敏感信息应登记缺口并限制展示，不代填个人证件或银行账户。",
        "Collect employee IDs, itinerary dates and destinations, expense lines, invoice identifiers, tax, currency, cost centers, advances, approvals and payment evidence. Record transaction date, policy version and exchange-rate source; log gaps and restrict sensitive information rather than inventing identity or bank details.",
      ],
      method: [
        "逐笔依据适用职级、城市、住宿天数、补贴标准及审批确定应报金额，区分公司支付、个人垫付与预借款。先按原币汇总再采用已批准汇率换算，设置票据唯一键并标注政策例外；未经财务确认的金额不能视为最终付款。",
        "Determine eligible amounts from applicable grade, city, nights, allowances and approvals. Separate company-paid, employee-paid and advance amounts; aggregate by currency before approved conversion, check invoice keys and flag policy exceptions. Estimates are not final payments.",
      ],
      design: [
        "建立票据明细、政策参数、计算、付款对账及异常清单工作表；输入格与公式格分别标记并附文字说明，单据编号保存为文本，日期和金额使用真实类型。冻结表头、添加筛选，报告注明期间与单位，按照最小权限展示员工信息。",
        "Separate receipts, policy assumptions, calculations, payment reconciliation and exceptions. Distinguish inputs and formulas with a legend, preserve identifiers as text, use typed dates and amounts, freeze and filter headers, show period and units, and minimize personal-data access.",
      ],
      checks: [
        "分别核验费用明细与对应分摊额，以及个人应报、预借冲销、付款和退款形成的未结余额；按政策说明正负号与期间，公司代付不计入个人应付。抽查重复票据、跨期退款和零汇率；独立复核关键公式并披露缺凭证或未重算，不能声称已经付款。",
        "Reconcile expense details to their allocations, then separately reconcile employee claims, advance settlements, payments and refunds to the outstanding balance, using documented signs and periods; exclude company-paid items from employee payables. Review duplicates, refunds, rates and formulas, disclosing missing evidence or recalculation.",
      ],
    },
    scenarios: scenarios(
      "expense-reimbursement",
      ["员工、报销审核人和财务", "Employees, expense reviewers, and finance"],
      {
        focus: [
          "按适用政策核定实际可报范围，保留经办人和复核状态。",
          "Apply the relevant policy and retain the preparer and review status.",
        ],
        inputs: [
          "记录单据来源、适用日期、员工编号和成本中心。",
          "Record evidence source, effective date, employee ID and cost center.",
        ],
        output: [
          "列明金额口径、处理意见、负责人及待确认事项。",
          "Show amount definitions, disposition, owner and open questions.",
        ],
        risk: [
          "缺少审批或凭证不得视为合规，员工信息按权限最小展示。",
          "Do not treat absent approvals or evidence as compliance; minimize personal-data exposure.",
        ],
      },
      [
        [
          ["差旅事前申请", "Travel preapproval"],
          [
            "对比申请行程与差旅标准及可用预算。",
            "Compare the proposed itinerary with travel policy and available budget.",
          ],
          [
            "收集目的地、起止日期、舱位、预估住宿和预算余额。",
            "Gather destination, dates, cabin, estimated lodging and available budget.",
          ],
          [
            "形成分项预算、超标原因与审批清单。",
            "Produce an itemized budget, exceptions and approval list.",
          ],
          [
            "批准申请不代表已经预订或发生付款。",
            "Approval does not mean bookings or payments have occurred.",
          ],
        ],
        [
          ["机票退改签核销", "Air ticket changes and refunds"],
          [
            "追踪原票、变更及退款之间的完整金额链。",
            "Trace the amounts from original ticket through changes and refunds.",
          ],
          [
            "收集原票号、改签单、差价、手续费和退款到账日。",
            "Gather ticket and change IDs, fare difference, fees and refund dates.",
          ],
          [
            "分别列示原票、追加费用和退回金额。",
            "Show original fare, incremental charges and refunds separately.",
          ],
          [
            "重复报销改签费或漏记跨期退款须复核。",
            "Review duplicate change-fee claims and cross-period refunds.",
          ],
        ],
        [
          ["住宿超标审批", "Lodging cap exception"],
          [
            "按城市、职级和入住晚数核对单晚限额。",
            "Compare nightly lodging rates with city and grade limits.",
          ],
          [
            "收集城市等级、每晚房价、住宿晚数及审批单。",
            "Gather city tier, nightly rate, nights and approval.",
          ],
          [
            "列出超标金额、季节例外及批准状态。",
            "Show excess amount, seasonal exceptions and approval status.",
          ],
          [
            "多人合住和政策生效日变化不能简单按整单判定。",
            "Shared rooms and policy effective-date changes need individual review.",
          ],
        ],
        [
          ["交通补贴核算", "Transport allowance"],
          [
            "核对差旅日交通补贴与实际报销费用。",
            "Reconcile travel-day transport allowances with actual claims.",
          ],
          [
            "收集出差天数、交通方式、接驳及车票金额。",
            "Gather travel days, transport mode, shuttles and fare amounts.",
          ],
          ["形成逐日补贴计算及扣减明细。", "Produce a daily allowance calculation and deductions."],
          [
            "公司接驳或同日车费与补贴重叠须依政策判断。",
            "Apply policy to overlapping shuttles, fares and allowances.",
          ],
        ],
        [
          ["餐补与招待分摊", "Meals and entertainment allocation"],
          [
            "区分个人餐补、公司供餐和客户招待。",
            "Separate personal meal allowances, provided meals and client entertainment.",
          ],
          [
            "收集餐次、参会名单、招待事由与已供餐记录。",
            "Gather meals, attendee lists, business purpose and provided meals.",
          ],
          [
            "按餐次列出应扣补贴和招待归属。",
            "List allowance deductions and entertainment allocation by meal.",
          ],
          [
            "同一餐次重复领取补贴或错误披露名单须复核。",
            "Review duplicate meal allowances and inappropriate attendee disclosure.",
          ],
        ],
        [
          ["跨币种差旅折算", "Foreign-currency travel claims"],
          [
            "比较原币费用、实际付款汇率与记账汇率。",
            "Compare original-currency costs, settlement rates and accounting rates.",
          ],
          [
            "收集币种、原币额、发生日、信用卡账单和汇率来源。",
            "Gather currencies, original amounts, dates, card statements and rate sources.",
          ],
          [
            "输出逐币种汇总、换算和汇差明细。",
            "Produce currency totals, conversion and exchange differences.",
          ],
          [
            "缺失汇率或混用不同日期汇率须保留待确认。",
            "Leave missing or inconsistent exchange rates unresolved.",
          ],
        ],
        [
          ["借款冲销与补退款", "Advance settlement"],
          [
            "按员工和预借单计算应补款或应退余额。",
            "Calculate reimbursement or employee repayment by advance.",
          ],
          [
            "收集预借编号、金额、已核准票据和此前冲销。",
            "Gather advance IDs, amounts, approved receipts and previous settlements.",
          ],
          [
            "输出冲销表及双向余额明细。",
            "Produce settlement and both reimbursement and repayment balances.",
          ],
          [
            "不得重复冲抵已结借款或将负余额误作付款。",
            "Do not reuse settled advances or misstate negative balances.",
          ],
        ],
        [
          ["重复票据排查", "Duplicate receipt review"],
          [
            "识别跨批次疑似重复提交及票据冲红。",
            "Identify possible duplicates and invoice reversals across batches.",
          ],
          [
            "收集票据代码号码、含税额、开票日和提交人。",
            "Gather invoice identifiers, gross amount, issue date and claimant.",
          ],
          [
            "输出疑似重复组与人工复核记录。",
            "Produce candidate duplicate groups and review records.",
          ],
          [
            "同号不同票种及红冲重开不得自动认定欺诈。",
            "Do not automatically classify reused numbers or corrected invoices as fraud.",
          ],
        ],
        [
          ["无票支出补充材料", "Missing receipt exception"],
          [
            "核对缺票原因与政策允许的替代证明。",
            "Check missing-receipt reasons against permitted alternative evidence.",
          ],
          [
            "收集业务事由、金额、补票期限、证明与批准人。",
            "Gather business purpose, amount, evidence deadline, proof and approver.",
          ],
          [
            "生成待补材料及例外审批跟踪表。",
            "Produce a missing-evidence and exception-approval tracker.",
          ],
          [
            "不得伪造票据或将待补材料标成已通过。",
            "Never fabricate receipts or mark incomplete evidence as approved.",
          ],
        ],
        [
          ["月末未报费用预提", "Month-end unclaimed expense accrual"],
          [
            "按行程结束日期估计未报销费用及下期冲回。",
            "Estimate unclaimed travel expenses by trip end and schedule reversal.",
          ],
          [
            "收集已结束行程、预估支出、历史凭证与入账期间。",
            "Gather completed trips, estimated costs, prior entries and accounting periods.",
          ],
          [
            "列出预提依据、冲回计划与实际差异。",
            "Show accrual basis, reversal schedule and actual variance.",
          ],
          [
            "实际报销后须检查重复计提和跨期归属。",
            "Check double accrual and period attribution after actual claims.",
          ],
        ],
        [
          ["多人共同出差分摊", "Shared travel cost allocation"],
          [
            "按实际受益人和成本中心分摊共同票据。",
            "Allocate shared receipts to beneficiaries and cost centers.",
          ],
          [
            "收集参与人、共同票据、受益单位与分摊比例。",
            "Gather participants, shared receipts, beneficiaries and allocation percentages.",
          ],
          [
            "输出人员分摊额及与原票金额的核对。",
            "Produce individual allocations reconciled to each original receipt.",
          ],
          [
            "分摊比例不满或超过百分之百时不得静默补齐。",
            "Do not silently correct allocations that do not sum to 100 percent.",
          ],
        ],
        [
          ["报销批次付款对账", "Expense payment batch reconciliation"],
          [
            "核对审批金额与银行批次回执及退回记录。",
            "Reconcile approved expense amounts to bank batch confirmations and returns.",
          ],
          [
            "收集批次号、收款人标识、核准金额与回执状态。",
            "Gather batch IDs, payee identifiers, approved amounts and receipt statuses.",
          ],
          [
            "列出已付、失败、退回和待重付金额。",
            "Separate paid, failed, returned and pending retry amounts.",
          ],
          [
            "银行无回执不能标记付款成功，账户信息须脱敏。",
            "Do not mark payment successful without a bank receipt; mask account data.",
          ],
        ],
      ],
    ),
  },
  {
    id: "cashflow-treasury",
    name: ["资金与现金流", "Treasury and cash flow"],
    category: "spreadsheet",
    format: "XLSX",
    summary: [
      "建立账户资金头寸、滚动排程与流动性核对",
      "Build account positions, rolling schedules, and liquidity reconciliations",
    ],
    style: ["资金口径明确、可追溯", "Traceable with explicit liquidity definitions"],
    sections: sections([
      [
        "accounts",
        "账户与主体",
        "Accounts and entities",
        "登记账户、法人、币种及余额状态。",
        "Record account, entity, currency and balance status.",
      ],
      [
        "opening",
        "期初头寸",
        "Opening position",
        "区分账面、可用与受限资金。",
        "Separate ledger, available and restricted cash.",
      ],
      [
        "flows",
        "收付款排程",
        "Cash movements",
        "按来源、日期和确定性编排收付款。",
        "Schedule inflows and outflows by source, date and certainty.",
      ],
      [
        "facilities",
        "授信与限制",
        "Facilities and restrictions",
        "列示可用授信、到期日和资金限制。",
        "Show facilities, maturity and cash restrictions.",
      ],
      [
        "forecast",
        "滚动头寸",
        "Rolling position",
        "按币种衔接每日或每周余额。",
        "Roll daily or weekly balances by currency.",
      ],
      [
        "review",
        "差异与行动",
        "Differences and actions",
        "记录资金缺口、责任人和未确认假设。",
        "Record liquidity gaps, owners and unconfirmed assumptions.",
      ],
    ]),
    acceptance: [
      [
        "各账户期初、收付和期末逐币种勾稽。",
        "Opening, movements and closing reconcile by account and currency.",
      ],
      [
        "受限资金、可用现金与授信不得混同。",
        "Keep restricted cash, available cash and facilities distinct.",
      ],
      [
        "排程、审批与实际银行付款状态清楚区分。",
        "Distinguish schedules and approvals from actual bank payments.",
      ],
    ],
    workflow: [
      ["获取账户余额及来源单据。", "Gather balances and source records."],
      [
        "确认日期、币种、限制和内部调拨。",
        "Confirm dates, currencies, restrictions and transfers.",
      ],
      ["计算滚动余额和资金缺口。", "Calculate rolling balances and shortages."],
      ["复核银行差异并记录待办。", "Review bank differences and record actions."],
    ],
    playbook: {
      inputs: [
        "收集银行账户与法人映射、各币种期初余额、流水、合同收付款日期、工资税款计划、授信和受限资金记录，写明时间范围、银行截止时间、假日规则、最后更新时间及汇率来源。预计款项标注证据和负责人，缺项保持待确认。",
        "Gather account-to-entity mappings, opening balances, statements, contractual dates, payroll, taxes, facilities and restricted funds. Record horizon, bank cutoffs, holidays, update time and rate sources; tag forecast evidence and owners, leaving gaps unconfirmed.",
      ],
      method: [
        "按实际或约定收付日编排资金流，将已确认、预计和内部调拨分层；逐币种计算期初加流入减流出等于期末，再按有来源的日期汇率折算。单列不能动用资金、信用额度及截止日情景，缺口应升级审批，不能自动支付。",
        "Schedule actual and forecast flows by date, distinguishing committed items, estimates and internal transfers. Reconcile opening plus inflows minus outflows to closing by currency, translate using sourced rates, and show restricted cash, facilities and cutoff scenarios; escalate gaps without paying automatically.",
      ],
      design: [
        "按账户和日期保留原始流水，在独立工作表管理假设、滚动排程、汇总和异常，内部转账保留双方关联号。表头说明币种、单位、更新时间与输入约定，冻结维度并允许筛选，不同主体及不同期限不得在未说明边界时合并。",
        "Retain transactions by account and date; separate assumptions, rolling schedules, summaries and exceptions, linking both sides of transfers. State currency, units, update time and input conventions, freeze and filter dimensions, and do not silently combine entities or maturities.",
      ],
      checks: [
        "核对每个账户期初与银行余额、滚动首尾衔接及集团内部调拨抵消，抽查受限余额、负数、重复流水和授信到期；区别零余额与资料缺失。检查延迟回款和提前付款情景，未真实重算或缺少银行对账单时如实列示未验证项。",
        "Reconcile account openings, bank balances, consecutive periods and eliminated transfers. Inspect restrictions, negative cash, duplicate transactions and facility maturities, distinguishing zero from missing; stress delayed receipts and early payments, disclosing unavailable statements or recalculation.",
      ],
    },
    scenarios: scenarios(
      "cashflow-treasury",
      ["资金专员、财务负责人和审批人", "Treasury staff, finance leaders, and approvers"],
      {
        focus: [
          "明确账户主体、资金状态和决策所需时间窗口。",
          "Specify account ownership, liquidity status and the decision window.",
        ],
        inputs: [
          "保留币种、基准日期、来源编号、更新时间和责任人，同时记录银行截止时刻及资金限制条件。",
          "Retain currency, as-of date, source ID, update time and owner, along with bank cutoff and restrictions.",
        ],
        output: [
          "展示逐笔依据、金额口径、处理状态与待决事项。",
          "Show item-level evidence, amount definitions, status and open decisions.",
        ],
        risk: [
          "未经证实的银行余额和付款不得作为已完成事实。",
          "Do not present unverified bank balances or payments as completed facts.",
        ],
      },
      [
        [
          ["日终银行余额对账", "Daily bank reconciliation"],
          [
            "比较银行流水与账面余额并解释未达项目。",
            "Compare bank and ledger balances and explain outstanding items.",
          ],
          [
            "收集银行对账单、总账余额、在途款和账户别名。",
            "Gather statements, ledger balances, in-transit amounts and account aliases.",
          ],
          [
            "列出期末差额、未达账龄和复核责任。",
            "List closing differences, outstanding-item ages and reviewers.",
          ],
          [
            "转账在途不能重复算作双方可用余额。",
            "Do not count an in-transit transfer in both available balances.",
          ],
        ],
        [
          ["十三周资金滚动表", "Thirteen-week cash schedule"],
          [
            "按自然周追踪期初、预计收付和期末。",
            "Track opening cash, forecast movements and closing cash by week.",
          ],
          [
            "收集每日收付日期、确定性、上周版本及期初余额。",
            "Gather dated movements, certainty, prior version and opening cash.",
          ],
          [
            "生成十三周余额、最低点及版本变化说明。",
            "Produce thirteen weekly balances, minimum cash and version changes.",
          ],
          [
            "已签约金额与预计项目不得混为已到账。",
            "Neither committed nor forecast amounts are cash received.",
          ],
        ],
        [
          ["工资发放资金排程", "Payroll funding schedule"],
          [
            "按法人和发薪日安排净薪及相关代扣资金。",
            "Schedule net payroll and withholding funding by entity and pay date.",
          ],
          [
            "收集发薪日、净薪合计、社保代扣及银行截止日。",
            "Gather pay dates, net payroll, statutory deductions and bank cutoffs.",
          ],
          ["形成资金需求日期和审批准备清单。", "Produce funding dates and approval readiness."],
          ["节假日和银行截止时间变化须人工确认。", "Manually confirm holiday and cutoff changes."],
        ],
        [
          ["税款缴纳排期", "Tax payment schedule"],
          [
            "按税种和属期安排申报与缴款现金需求。",
            "Schedule filing and funding needs by tax type and period.",
          ],
          [
            "收集税种、属期、申报日、预计税额和缴款账户。",
            "Gather tax type, period, filing date, estimated amount and account.",
          ],
          [
            "列出到期时间、资金来源和待确认税额。",
            "List deadlines, funding sources and unconfirmed tax amounts.",
          ],
          ["估计金额不是申报结果，也不替代税务意见。", "Estimates are not filings or tax advice."],
        ],
        [
          ["供应商付款优先级", "Supplier payment prioritization"],
          [
            "结合合同到期、验收及现金可用性安排批次。",
            "Prioritize batches using due dates, acceptance and available cash.",
          ],
          [
            "收集发票、合同到期、验收金额、违约条款和授权。",
            "Gather invoices, due dates, accepted amounts, penalties and authorization.",
          ],
          [
            "输出候选付款顺序及影响说明。",
            "Produce a proposed payment order and impact explanation.",
          ],
          [
            "缺验收或授权的付款不得自动执行。",
            "Do not execute payments lacking acceptance or authorization.",
          ],
        ],
        [
          ["集团内部资金调拨", "Intercompany cash transfers"],
          [
            "匹配转出转入并识别合并口径内部交易。",
            "Match both sides and identify transfers for consolidation.",
          ],
          [
            "收集双方主体、账户、币种、金额和转账关联号。",
            "Gather both entities, accounts, currencies, amounts and transfer references.",
          ],
          [
            "输出双边配对、在途款和合并抵消表。",
            "Produce matched transfers, in-transit items and eliminations.",
          ],
          [
            "币种不一致或单边入账不得强行抵消。",
            "Do not force elimination of currency mismatches or one-sided entries.",
          ],
        ],
        [
          ["授信额度与到期跟踪", "Credit facility tracking"],
          [
            "按合同规则计算已用与剩余额度并跟进到期。",
            "Track facility usage, availability and maturity under contract terms.",
          ],
          [
            "收集额度、已提款、利率、担保及到期日。",
            "Gather limits, drawings, interest, collateral and maturity.",
          ],
          [
            "输出额度使用表、到期提醒和续约事项。",
            "Produce facility usage, maturity alerts and renewal actions.",
          ],
          [
            "授信可用额不是银行现金，循环条件需确认。",
            "Undrawn credit is not bank cash; confirm revolving conditions.",
          ],
        ],
        [
          ["定期存款到期计划", "Term deposit maturities"],
          [
            "预测定存本金到期、续存与可动用日期。",
            "Schedule term-deposit maturity, renewal and availability.",
          ],
          [
            "收集存入日、到期日、利率及提前支取限制。",
            "Gather start, maturity, rate and early-withdrawal restrictions.",
          ],
          [
            "输出到期清单、预计利息及续存确认。",
            "Produce maturities, estimated interest and renewal confirmations.",
          ],
          [
            "未到期锁定本金不能计入可自由支付现金。",
            "Exclude locked principal from freely available cash.",
          ],
        ],
        [
          ["多币种头寸归集", "Multi-currency cash positions"],
          [
            "按币种和账户汇总余额及预期收付。",
            "Summarize balances and expected movements by currency and account.",
          ],
          [
            "收集原币余额、折算日期、汇率和使用限制。",
            "Gather original-currency balances, translation date, rates and restrictions.",
          ],
          [
            "输出原币头寸及单独列示的折算总额。",
            "Show original-currency positions and separately translated totals.",
          ],
          [
            "不同币种不得直接相加，缺失汇率须提示。",
            "Never add currencies directly; flag missing rates.",
          ],
        ],
        [
          ["银行手续费差异核验", "Bank fee variance review"],
          [
            "对照协议检查流水手续费、税额及最低收费。",
            "Compare charged bank fees, tax and minimums to agreements.",
          ],
          [
            "收集收费流水、费率表、计费基数与退费记录。",
            "Gather fee transactions, rate schedules, bases and refunds.",
          ],
          [
            "输出应付手续费估算及差异复核项。",
            "Produce expected bank-fee estimates and review items.",
          ],
          [
            "冲回或重复扣费须核对，协议缺失不作定论。",
            "Review reversals and duplicates; do not conclude without the agreement.",
          ],
        ],
        [
          ["资金缺口压力测试", "Liquidity stress test"],
          [
            "比较回款延迟、付款提前和基准情景。",
            "Compare base, delayed-receipt and accelerated-payment scenarios.",
          ],
          [
            "收集应收日期、付款承诺、最低现金要求和融资条件。",
            "Gather collection dates, obligations, minimum cash and financing terms.",
          ],
          [
            "展示最低余额、缺口发生日及可选措施。",
            "Show minimum cash, shortfall date and possible responses.",
          ],
          [
            "融资可执行性和情景概率未经批准不得假定。",
            "Do not assume financing availability or scenario probabilities.",
          ],
        ],
        [
          ["受限资金台账", "Restricted cash register"],
          [
            "跟踪冻结、保证金及其他不可自由动用资金。",
            "Track frozen funds, deposits and other restricted cash.",
          ],
          [
            "收集限制原因、金额、起止日及解除条件。",
            "Gather restriction reasons, amounts, dates and release conditions.",
          ],
          [
            "输出受限明细、可用余额调节与到期事项。",
            "Produce restricted balances, available-cash bridge and release actions.",
          ],
          [
            "未确认解限前不得并入可支付余额。",
            "Do not include funds in spendable cash before release is confirmed.",
          ],
        ],
      ],
    ),
  },
  {
    id: "accounts-receivable",
    name: ["应收与催收", "Accounts receivable and collections"],
    category: "spreadsheet",
    format: "XLSX",
    summary: [
      "按客户、发票与回款核对应收余额及催收行动",
      "Reconcile receivables and collection actions by customer, invoice, and receipt",
    ],
    style: ["分层清晰、证据可追溯", "Segmented and evidence-led"],
    sections: sections([
      [
        "scope",
        "客户与账期",
        "Customers and periods",
        "明确法人、客户、合同和统计基准日。",
        "Specify entities, customers, contracts and the as-of date.",
      ],
      [
        "invoices",
        "发票明细",
        "Invoice detail",
        "保留发票、贷项、到期日和原币余额。",
        "Retain invoices, credits, due dates and original-currency balances.",
      ],
      [
        "receipts",
        "回款核销",
        "Receipt application",
        "匹配流水、核销及未分配款项。",
        "Match bank receipts, applications and unapplied cash.",
      ],
      [
        "aging",
        "账龄与信用",
        "Aging and credit",
        "按统一口径分层并列示授信占用。",
        "Segment aging consistently and show credit usage.",
      ],
      [
        "disputes",
        "争议与催收",
        "Disputes and collections",
        "记录争议、承诺付款、责任和跟进。",
        "Record disputes, payment promises, ownership and follow-up.",
      ],
      [
        "reconcile",
        "核对与例外",
        "Reconciliation and exceptions",
        "勾稽期初期末并跟踪差异。",
        "Reconcile opening and closing balances and track differences.",
      ],
    ]),
    acceptance: [
      [
        "发票、回款、贷项及余额可追溯到来源。",
        "Invoices, receipts, credits and balances trace to source.",
      ],
      ["账龄基准日和坏账政策版本明确。", "Aging date and impairment-policy versions are explicit."],
      [
        "未确认争议和未回对账函不得标为已结清。",
        "Do not close unresolved disputes or unanswered confirmations.",
      ],
    ],
    workflow: [
      ["汇总合同、发票及银行流水。", "Gather contracts, invoices and bank receipts."],
      ["统一客户键、币种和截止日。", "Align customer keys, currency and cutoff."],
      ["分层账龄并匹配回款。", "Age balances and match receipts."],
      ["复核争议、责任及后续催收。", "Review disputes, owners and next collection actions."],
    ],
    playbook: {
      inputs: [
        "收集法人、客户编号、合同和发票编号、开票金额、贷项、到期日、银行回款、核销记录、信用额度及往来沟通，并记录统一统计基准日和币种。合同条款、争议证据或责任人缺失时保留空缺，不推断客户承诺。",
        "Gather entities, customer and contract IDs, invoices, credits, due dates, bank receipts, applications, credit limits and communications. Record the as-of date and currency; leave absent terms, dispute evidence or ownership unresolved rather than inventing commitments.",
      ],
      method: [
        "按客户、发票与原币核对期初加新增应收减已分配回款减经批准坏账转销再加其他调整后的期末余额；回款匹配只分配款项，不重复扣减。以统一基准日计算账龄，贷项和争议单列；信用及减值仅按企业已批准政策测算。",
        "Reconcile opening plus new receivables less applied receipts and approved bad-debt write-offs plus other adjustments by customer, invoice and currency; matching a receipt must not deduct it twice. Age balances consistently, show credits and disputes separately, and use approved credit and impairment policies.",
      ],
      design: [
        "分设原始发票、回款核销、信用条款、账龄分析、催收行动和差异工作表；合同和发票编号保留文本，日期、金额及比例使用真实类型。以明确标签区分实际回款、预计回款和客户承诺，联系人信息仅授权人员查看。",
        "Separate source invoices, receipt applications, credit terms, aging, collection actions and exceptions. Keep identifiers as text and dates, amounts and rates typed; distinguish actual receipts, estimates and promises, and restrict contact information to authorized users.",
      ],
      checks: [
        "按原币核对期初期末及总账，抽查多笔回款分配、负余额、重复发票、到期日变化和跨客户抵扣；未回函不等于客户确认。独立复核关键账龄及汇总公式，无法重算或缺少银行记录时如实标记未验证并明确责任人。",
        "Reconcile opening and closing to the ledger by currency; inspect receipt allocations, negative balances, duplicates, changed due dates and cross-customer offsets. An unanswered confirmation is not acceptance; review critical formulas and disclose unavailable recalculation or statements.",
      ],
    },
    scenarios: scenarios(
      "accounts-receivable",
      ["应收会计、销售及催收负责人", "Receivables accountants, sales, and collection owners"],
      {
        focus: [
          "按照合同和企业信用政策确定处理动作与责任。",
          "Determine action and ownership under contract and approved credit policy.",
        ],
        inputs: [
          "保留客户编号、法人、原币、基准日和单据来源，记录合同原约定及最近一次核对时间。",
          "Retain customer ID, entity, original currency, as-of date and source, original contract terms and latest reconciliation date.",
        ],
        output: [
          "列出未清金额、经办责任、证据及下一次跟进时间。",
          "Show open balances, owners, evidence and next follow-up dates.",
        ],
        risk: [
          "缺少回款凭据或客户确认时不得标记已收或已结清。",
          "Do not mark amounts received or settled without payment evidence or confirmation.",
        ],
      },
      [
        [
          ["客户账龄分层", "Customer aging segments"],
          ["按到期日区分未到期和各逾期区间。", "Segment current and overdue invoices by due date."],
          [
            "收集发票号、到期日、未清金额、贷项和争议。",
            "Gather invoice IDs, due dates, open amounts, credits and disputes.",
          ],
          [
            "输出账龄分布及客户明细并标出负余额。",
            "Produce aging distribution and customer detail with negative balances flagged.",
          ],
          ["贷项不能掩盖其他发票逾期。", "Credits must not conceal overdue invoices."],
        ],
        [
          ["逾期发票催收", "Overdue invoice collections"],
          [
            "按合同约定与逾期程度安排提醒和升级。",
            "Schedule reminders and escalation by contractual terms and overdue days.",
          ],
          [
            "收集逾期天数、历史联系、联系人和下一行动。",
            "Gather days overdue, contact history, contacts and next action.",
          ],
          [
            "形成优先级、沟通记录和升级计划。",
            "Produce priorities, communications and escalation plans.",
          ],
          [
            "不得擅自承诺延期或使用不合规催收方式。",
            "Do not promise extensions or use inappropriate collection methods.",
          ],
        ],
        [
          ["回款认领与核销", "Receipt matching and application"],
          ["将银行到账与一笔或多笔应收匹配。", "Match bank receipts to one or more open invoices."],
          [
            "收集流水号、汇款参考号、发票编号与金额。",
            "Gather bank transaction, remittance reference, invoice IDs and amounts.",
          ],
          [
            "输出核销映射及收付款双方未分配余额。",
            "Produce application mappings and unapplied balances on both sides.",
          ],
          [
            "无法识别来源时不得强行核销客户发票。",
            "Do not force an invoice match for unidentified receipts.",
          ],
        ],
        [
          ["客户对账函差异", "Customer statement differences"],
          [
            "比较双方期间内余额及逐笔差异。",
            "Compare customer and company balances and transactions.",
          ],
          [
            "收集对账区间、双方金额、回函状态和差异证据。",
            "Gather statement period, both balances, response status and evidence.",
          ],
          [
            "输出差异清单、处理责任和回函跟踪。",
            "Produce differences, owners and confirmation tracking.",
          ],
          [
            "客户未回函不代表确认余额。",
            "No customer response does not imply balance confirmation.",
          ],
        ],
        [
          ["争议款闭环跟踪", "Disputed receivables"],
          [
            "追踪质量、价格或收货争议的处理过程。",
            "Track the resolution of quality, pricing or delivery disputes.",
          ],
          [
            "收集争议金额、原因、支持证据、责任部门及期限。",
            "Gather disputed amount, reason, evidence, team and deadline.",
          ],
          [
            "列示调查结果、批准处理及未决余额。",
            "Show findings, approved resolution and unresolved balance.",
          ],
          ["未经批准不得自行冲销争议金额。", "Do not write off disputes without approval."],
        ],
        [
          ["信用额度使用监控", "Credit limit utilization"],
          [
            "按客户政策比较额度、未清应收和订单占用。",
            "Compare approved limits against receivables and order exposure.",
          ],
          [
            "收集核定额度、未清发票、在途订单及担保。",
            "Gather limits, open invoices, outstanding orders and guarantees.",
          ],
          [
            "输出可用额度、超限项目和审批状态。",
            "Show available credit, breaches and approval status.",
          ],
          ["在途订单是否占额须以现行政策为准。", "Use current policy to determine order exposure."],
        ],
        [
          ["分期付款履约表", "Installment compliance"],
          [
            "核对合同分期计划与实际到账和延期。",
            "Compare contractual installments with receipts and extensions.",
          ],
          [
            "收集每期金额、到期日、到账记录和展期审批。",
            "Gather installment amounts, due dates, receipts and approved extensions.",
          ],
          [
            "输出分期履约、逾期及合同总额核对。",
            "Produce installment status, overdue items and contract-total reconciliation.",
          ],
          [
            "分期合计超合同额或重复匹配应冻结待查。",
            "Hold over-contract totals or duplicate matches for review.",
          ],
        ],
        [
          ["坏账准备口径核对", "Impairment policy review"],
          [
            "按核准账龄及风险分组测算准备。",
            "Estimate provisions using approved aging and risk groups.",
          ],
          [
            "收集政策版本、风险等级、损失率和未清余额。",
            "Gather policy version, risk grade, loss rates and open balances.",
          ],
          [
            "输出计算依据、准备估算和政策例外。",
            "Show calculation basis, estimated provision and exceptions.",
          ],
          [
            "缺失损失率不能设为零，也非审计结论。",
            "Do not replace missing loss rates with zero or present estimates as audit conclusions.",
          ],
        ],
        [
          ["预收款抵扣检查", "Advance offset review"],
          [
            "核对预收款与应收发票的授权抵扣。",
            "Review authorized offsets between advances and invoices.",
          ],
          [
            "收集客户、合同、预收余额、发票及抵扣审批。",
            "Gather customers, contracts, advance balances, invoices and approvals.",
          ],
          ["列出抵扣映射及使用前后余额。", "List offset mappings and before-and-after balances."],
          [
            "未经批准不得跨客户或跨法人抵扣。",
            "Do not offset across customers or entities without approval.",
          ],
        ],
        [
          ["账期例外审批", "Payment-term exceptions"],
          [
            "比较原账期与核准延期及新到期日。",
            "Compare original terms with approved extensions and revised dates.",
          ],
          [
            "收集合同条款、延期天数、批准人和生效区间。",
            "Gather contract terms, extension days, approver and validity period.",
          ],
          [
            "输出条款变化、到期日和审批记录。",
            "Produce term changes, due dates and approval records.",
          ],
          [
            "保留原始账期，不将口头请求视为批准。",
            "Preserve original terms and do not treat requests as approvals.",
          ],
        ],
        [
          ["重点客户付款承诺", "Key account payment promises"],
          ["跟踪承诺付款与实际到账偏差。", "Track promises to pay against actual receipts."],
          [
            "收集承诺金额、日期、沟通记录与到账凭据。",
            "Gather promised amounts, dates, communication and receipt evidence.",
          ],
          [
            "输出承诺兑现率、未兑现项目与升级节点。",
            "Show promise fulfillment, missed commitments and escalation points.",
          ],
          [
            "承诺日期不等于到账日期，比例分母需说明。",
            "A promised date is not a receipt date; define rate denominators.",
          ],
        ],
        [
          ["跨期收款归属核查", "Cross-period receipt attribution"],
          [
            "区分到账日、银行入账日及会计归属期。",
            "Separate receipt date, bank posting date and accounting period.",
          ],
          [
            "收集到账时间、银行流水、发票属期和关账规则。",
            "Gather receipt time, statements, invoice period and close rules.",
          ],
          [
            "输出跨期差异及需复核的记账期间。",
            "Produce cross-period differences and periods requiring review.",
          ],
          [
            "不得将资金日期自动等同于收入确认期间。",
            "Do not equate cash dates with revenue recognition periods.",
          ],
        ],
      ],
    ),
  },
  officeFamily({
    id: "management-accounting",
    name: ["管理会计分析", "Management accounting"],
    category: "spreadsheet",
    format: "XLSX",
    summary: [
      "以责任中心、成本动因和经营差异支撑管理决策",
      "Support management decisions with responsibility centers, cost drivers and variances",
    ],
    headings: [
      ["范围与口径", "Scope and definitions"],
      ["实际与预算", "Actuals and budget"],
      ["收入与成本", "Revenue and costs"],
      ["分摊动因", "Allocation drivers"],
      ["差异分析", "Variance analysis"],
      ["行动与复核", "Actions and review"],
    ],
    audience: [
      "管理会计、部门负责人和经营管理层",
      "Management accountants, department owners, and business leaders",
    ],
    playbook: {
      inputs: [
        "收集组织、产品、项目、科目与期间主数据，以及总账实际、已批准预算、订单、数量和工时等业务驱动；说明法人、币种、含税口径及来源版本。成本率、分摊规则和缺失数据均单列，保留编制人与核对日期，不覆盖原始凭证。",
        "Gather entity, product, project, account and period master data, actual ledger, approved budgets, orders, quantities and labor hours. State currency, tax basis and source versions; separately record rates, allocation rules, missing data, preparer and review date without overwriting source evidence.",
      ],
      method: [
        "统一权责发生期间，将收入、变动成本、固定成本及可控费用分别计算；写明成本池、分摊动因、分母和未分配余额。对预算差异按金额与比例解释并保留基数为零的状态，贡献利润不得混同财务报表毛利。",
        "Align accrual periods and calculate revenue, variable costs, fixed costs and controllable expenses separately. Document allocation pools, drivers, denominators and unallocated balances; explain monetary and percentage variances, retaining zero-base cases and distinguishing contribution from statutory gross profit.",
      ],
      design: [
        "设置原始明细、预算版本、分摊参数、计算、经营汇总和核对工作表；责任中心与产品编号保留文本，输入和公式使用文字图例区分。汇总表明确期间、币种、单位和实际或预测标识，长字段可筛选且不隐藏来源。",
        "Separate source detail, budget versions, allocation assumptions, calculations, management summaries and checks. Keep identifiers as text, distinguish inputs and formulas with a legend, and label period, currency, units and actual versus forecast without hiding sources.",
      ],
      checks: [
        "核对分摊前后总额、未分配成本、部门汇总及总账，抽查重复工时、错误成本率、跨期和零分母；解释差异分解残差及口径变化。独立复核关键公式并注明实际重算状态，管理估算不冒充经审计报表或已实现收益。",
        "Reconcile allocation totals, unallocated costs, departmental summaries and the ledger; inspect duplicate hours, rates, cutoff and zero denominators. Explain bridge residuals and definition changes, review key formulas and disclose recalculation status; estimates are not audited results.",
      ],
    },
    context: {
      focus: [
        "明确责任中心、可控范围及实际与预算版本。",
        "State responsibility center, controllability and actual/budget versions.",
      ],
      inputs: [
        "保留期间、币种、来源版本、业务动因和审批口径，并记录成本归属政策及责任中心版本。",
        "Retain period, currency, source version, drivers, approved definitions, cost-attribution policy and responsibility-center version.",
      ],
      output: [
        "列明计算依据、差异解释、责任人和下一步行动。",
        "Show calculation basis, variance explanations, owners and next actions.",
      ],
      risk: [
        "缺失分摊基数或预算版本时不得以零代替，更不能视为审计结论。",
        "Do not replace missing allocation bases or budget versions with zero or treat estimates as audited results.",
      ],
    },
    rows: [
      [
        ["产品毛利桥", "Product gross margin bridge"],
        [
          "分解销量、价格、单位成本和产品结构的毛利变化。",
          "Bridge gross-profit change through volume, price, unit cost and mix.",
        ],
        [
          "收集各产品两期数量、单价、单位成本及退货。",
          "Gather product volumes, prices, unit costs and returns for both periods.",
        ],
        [
          "按固定顺序列出各驱动和分解残差。",
          "Show drivers in a declared order and disclose residuals.",
        ],
        [
          "分解顺序不同会影响结果，不能重复归因。",
          "Attribution depends on ordering and must not be double counted.",
        ],
      ],
      [
        ["渠道费用分摊", "Channel cost allocation"],
        [
          "按收入、订单量或工时分摊渠道成本池。",
          "Allocate channel cost pools using revenue, orders or labor hours.",
        ],
        [
          "收集费用池、渠道主数据、动因和批准比例。",
          "Gather cost pools, channels, drivers and approved percentages.",
        ],
        ["输出各渠道分摊额和未分配余额。", "Show allocation by channel and unallocated amounts."],
        [
          "分母为零时应保留未分配，不硬记零成本。",
          "Retain unallocated amounts when the denominator is zero.",
        ],
      ],
      [
        ["部门预算差异", "Department budget variance"],
        [
          "比较已批准预算与同口径实际费用。",
          "Compare approved budget and actual expenses on a consistent basis.",
        ],
        [
          "收集预算版本、科目、部门、期间及实际数。",
          "Gather budget version, accounts, departments, periods and actuals.",
        ],
        [
          "按绝对额与比例列出重大差异及原因。",
          "List material absolute and percentage variances and causes.",
        ],
        ["零预算和一次性支出需单独解释。", "Explain zero budgets and one-off spending separately."],
      ],
      [
        ["单位经济模型", "Unit economics"],
        [
          "按订单或客户群计算收入及直接变动成本。",
          "Calculate revenue and direct variable costs per order or cohort.",
        ],
        [
          "收集订单数、客单价、退货、履约费和获客支出。",
          "Gather orders, average ticket, returns, fulfillment and acquisition costs.",
        ],
        ["输出单位贡献和样本期口径。", "Show unit contribution and cohort-period definitions."],
        [
          "生命周期及获客成本边界不可混用。",
          "Do not mix lifecycle and acquisition-cost boundaries.",
        ],
      ],
      [
        ["订单贡献利润", "Order contribution"],
        [
          "比较订单净收入与可避免变动支出。",
          "Compare net order revenue with avoidable variable spending.",
        ],
        [
          "收集折扣、运费、渠道佣金和履约成本。",
          "Gather discounts, freight, channel commission and fulfillment costs.",
        ],
        [
          "输出订单贡献额、比例和成本构成。",
          "Produce order contribution, margin and cost components.",
        ],
        [
          "分摊固定费用不得误当可避免成本。",
          "Do not classify allocated fixed costs as avoidable costs.",
        ],
      ],
      [
        ["固定成本覆盖", "Fixed-cost coverage"],
        [
          "测算单位贡献支持固定成本的临界销量。",
          "Calculate volume needed to cover fixed costs with unit contribution.",
        ],
        [
          "收集固定费用、单位售价、单位变动成本和销量。",
          "Gather fixed costs, unit price, variable unit cost and volume.",
        ],
        [
          "列出盈亏平衡销量及假设变动影响。",
          "Show break-even volume and sensitivity to assumptions.",
        ],
        [
          "单位贡献不为正时不存在有效盈亏平衡销量。",
          "No valid break-even volume exists with nonpositive unit contribution.",
        ],
      ],
      [
        ["产能成本分摊", "Capacity cost allocation"],
        [
          "按正常产能分配机台成本并单列闲置。",
          "Allocate machine costs using normal capacity and show idle cost separately.",
        ],
        [
          "收集机台成本、正常工时、实际工时和停工记录。",
          "Gather machine costs, normal and actual hours, and downtime.",
        ],
        ["输出产品吸收成本与未吸收金额。", "Show absorbed product costs and unabsorbed amounts."],
        [
          "不能将闲置成本静默全部压到合格品。",
          "Do not silently load all idle cost onto good units.",
        ],
      ],
      [
        ["项目投入产出复盘", "Project cost-benefit review"],
        [
          "比较立项预算、阶段支出和已证实收益。",
          "Compare approved budget, phased spend and evidenced benefits.",
        ],
        [
          "收集基线、支出凭证、收益指标和评估窗口。",
          "Gather baseline, spending evidence, benefit metrics and review window.",
        ],
        [
          "输出预算差异、实现率和未实现假设。",
          "Show budget variance, realization and unrealized assumptions.",
        ],
        [
          "预测节约不等于已经到账的现金收益。",
          "Forecast savings are not cash benefits already realized.",
        ],
      ],
      [
        ["人工工时成本归集", "Labor-hour cost allocation"],
        [
          "按项目、角色与核准成本率归集人工。",
          "Allocate labor to projects and roles at approved cost rates.",
        ],
        [
          "收集人员角色、项目编号、工时与费率有效日。",
          "Gather roles, project IDs, hours and rate effective dates.",
        ],
        ["输出项目人工成本和未分配工时。", "Show project labor costs and unallocated hours."],
        ["重复工时和缺失费率必须列入异常。", "Flag duplicate hours and missing rates."],
      ],
      [
        ["期间费用趋势拆解", "Period expense trends"],
        [
          "比较部门及科目的同比环比和一次性项目。",
          "Compare expense trends by department and account, including one-offs.",
        ],
        [
          "收集可比期间、科目映射及口径变化。",
          "Gather comparable periods, account mappings and definition changes.",
        ],
        [
          "列示趋势、重要变化及可比性说明。",
          "Show trends, material changes and comparability notes.",
        ],
        [
          "基期缺失或为零时不得计算误导性的增幅。",
          "Do not produce misleading growth rates for missing or zero bases.",
        ],
      ],
      [
        ["降本措施兑现", "Cost-saving realization"],
        [
          "跟踪降本举措目标、成本及实际兑现。",
          "Track cost-saving targets, implementation costs and realized benefits.",
        ],
        [
          "收集基线、负责人、目标、执行成本及凭据。",
          "Gather baseline, owner, target, implementation cost and evidence.",
        ],
        [
          "输出净节省、避免成本与现金节流。",
          "Show net savings, cost avoidance and cash savings separately.",
        ],
        [
          "相同收益被多个举措重复认领应剔除。",
          "Eliminate benefits claimed by multiple initiatives.",
        ],
      ],
      [
        ["管理层月度经营包", "Monthly management pack"],
        [
          "汇总收入、毛利、费用、现金及关键业务驱动。",
          "Summarize revenue, margin, costs, cash and business drivers.",
        ],
        [
          "收集结账版实际、预算版次、来源表和行动记录。",
          "Gather closed actuals, budget version, source schedules and actions.",
        ],
        ["形成指标表、差异说明和负责人清单。", "Produce metrics, variance commentary and owners."],
        ["现金与利润口径不同，不得混同解释。", "Do not conflate cash with profit."],
      ],
    ],
  }),
  officeFamily({
    id: "procurement-tender",
    name: ["采购招标管理", "Procurement and tendering"],
    category: "operations",
    format: "XLSX",
    summary: [
      "记录采购需求、报价比较、评审依据与审批状态",
      "Document procurement needs, bid comparisons, evaluation and approvals",
    ],
    headings: [
      ["需求与范围", "Requirements and scope"],
      ["供应商资格", "Supplier qualification"],
      ["报价归一", "Bid normalization"],
      ["评审标准", "Evaluation criteria"],
      ["偏差与风险", "Deviations and risks"],
      ["定标及交接", "Award and handover"],
    ],
    audience: [
      "采购人员、需求部门和评审委员会",
      "Procurement, requesters, and evaluation committees",
    ],
    playbook: {
      inputs: [
        "收集经授权的采购需求、技术规格、数量、交付地点、预算、询价文件、供应商资质与逐项报价，并记录截止日期、币种、税率、付款条件及评审规则版本。缺少报价或利益冲突申报时保留待补，不能编造供应商资格。",
        "Gather authorized requirements, specifications, quantities, delivery location, budget, requests, qualifications and itemized bids. Record deadlines, currencies, tax, payment terms and evaluation rules; leave missing bids or conflict declarations pending without inventing qualifications.",
      ],
      method: [
        "先区分资格门槛和评分项目，再按统一单位、数量、税费、运输与付款条件归一可比报价；技术偏差单列并交需求方确认。权重、评分依据和评审人签字分别留痕，异常低价或无效投标仅提示复核，不自动决定中标。",
        "Separate mandatory qualifications from scored criteria, then normalize bids for units, volume, taxes, freight and payment terms. Record technical deviations for requester review, retain weights and evaluator evidence, and flag abnormal bids without automatically awarding contracts.",
      ],
      design: [
        "以采购编号建立需求、资格、报价、评分、偏差、定标和交接工作表，保留供应商原始报价及版本；公式引用单独参数区，评分与审批状态使用明确文字。冻结供应商与项目列，尽量减少商业报价和个人联系方式，对外分发前由用户在受控位置设置访问权限。",
        "Organize requirements, qualifications, bids, scoring, deviations, award and handover by procurement ID, preserving original bid versions. Reference explicit parameters, label statuses and freeze key columns. Minimize commercial and contact data; users must set access permissions in a controlled location before distribution.",
      ],
      checks: [
        "复核报价单位换算、含税未税、评分权重合计和技术偏差确认，抽查缺席供应商、重复报价及评审利益冲突。总分和最低价均不能替代授权定标；公式未实际重算、未取得原始报价或未完成审批时必须如实列明。",
        "Check unit conversions, tax basis, scoring weights and confirmed deviations; inspect missing bidders, duplicate bids and conflicts. Neither score nor lowest price substitutes for authorized award; disclose absent source bids, approvals or actual formula recalculation.",
      ],
    },
    context: {
      focus: [
        "按采购编号和适用评审规则保留责任及处理依据。",
        "Retain ownership and decision evidence under the procurement ID and applicable rules.",
      ],
      inputs: [
        "注明规格版本、供应商、币种、报价日期及来源，补充送货条件、付款条款及评审文件生效版本。",
        "State specification version, supplier, currency, quote date and source, delivery conditions, payment terms and effective evaluation version.",
      ],
      output: [
        "列示可比结果、评审记录、审批状态及待补事项。",
        "Show comparable results, evaluation records, approval status and open items.",
      ],
      risk: [
        "未完成资格复核或授权前不得宣布中标或签署合同。",
        "Do not announce an award or sign before qualification review and authorization.",
      ],
    },
    rows: [
      [
        ["采购需求比价", "Purchase request comparison"],
        [
          "按相同规格比较候选供应商总拥有成本。",
          "Compare total ownership cost for equivalent specifications.",
        ],
        [
          "收集需求数量、单价、运费、服务费和交付地点。",
          "Gather quantities, unit prices, freight, service fees and delivery locations.",
        ],
        ["输出同口径比较和差异明细。", "Produce normalized comparisons and differences."],
        [
          "规格不一致的低价不能直接判为最优。",
          "A cheaper non-equivalent specification is not automatically best.",
        ],
      ],
      [
        ["询价答疑跟踪", "Request-for-quotation questions"],
        [
          "跟踪供应商疑问、答复与文件澄清。",
          "Track supplier questions, answers and document clarifications.",
        ],
        [
          "收集问题编号、提出日期、答复版本和接收方。",
          "Gather question IDs, dates, response versions and recipients.",
        ],
        [
          "输出待答复清单和统一澄清记录。",
          "Produce open questions and common clarification records.",
        ],
        [
          "重要澄清未同步给相关供应商会影响公平性。",
          "Unequal distribution of material clarifications risks fairness.",
        ],
      ],
      [
        ["投标资格核验", "Bidder qualification"],
        [
          "逐项检查准入条件、资质有效期及关联关系。",
          "Check eligibility, qualification expiry and affiliations.",
        ],
        [
          "收集证照、有效期、强制门槛和核验记录。",
          "Gather licenses, expiry dates, mandatory criteria and verification.",
        ],
        ["输出资格矩阵、缺项和复核责任。", "Produce an eligibility matrix, gaps and reviewers."],
        [
          "资料缺失不得擅自判断为满足或不满足。",
          "Do not infer compliance or noncompliance from missing evidence.",
        ],
      ],
      [
        ["综合评分表", "Weighted bid evaluation"],
        [
          "依据预先确定的技术、商务和服务权重评分。",
          "Score technical, commercial and service criteria using established weights.",
        ],
        [
          "收集评分细则、权重、评委分数与理由。",
          "Gather criteria, weights, evaluator scores and rationale.",
        ],
        [
          "输出评分明细、加权结果及分歧说明。",
          "Show detailed scores, weighted results and disagreements.",
        ],
        [
          "权重不合计或事后更改须暂停并记录。",
          "Stop and record invalid or retrospectively changed weights.",
        ],
      ],
      [
        ["商务条款偏差", "Commercial deviations"],
        [
          "比较付款、保修、违约和交付条款偏差。",
          "Compare deviations in payment, warranty, liability and delivery.",
        ],
        [
          "收集招标条款、供应商回应和法务意见。",
          "Gather tender terms, supplier responses and legal comments.",
        ],
        [
          "列出偏差、影响、责任人及谈判状态。",
          "List deviations, impacts, owners and negotiation status.",
        ],
        [
          "未评估责任上限不能视作标准条款已接受。",
          "Do not assume acceptance of unreviewed liability limits.",
        ],
      ],
      [
        ["报价归一化", "Bid price normalization"],
        [
          "统一币种、计量单位和税运费用以供比较。",
          "Normalize currency, units, tax and freight for comparison.",
        ],
        [
          "收集报价行、税率、汇率日期和数量阶梯。",
          "Gather bid lines, tax rates, dated exchange rates and quantity tiers.",
        ],
        [
          "输出原价、换算过程与可比总价。",
          "Show original prices, conversion and comparable totals.",
        ],
        [
          "汇率缺失及可选项不能静默纳入总价。",
          "Do not silently include optional items or use missing rates.",
        ],
      ],
      [
        ["供应商谈判纪要", "Supplier negotiation record"],
        [
          "记录价格、范围与交期的谈判轮次。",
          "Record negotiation rounds for price, scope and delivery.",
        ],
        [
          "收集参会人、议题、报价版本和待确认条款。",
          "Gather participants, agenda, quote versions and open terms.",
        ],
        [
          "输出双方确认事项、未决分歧和行动期限。",
          "Show agreed points, open disagreements and action dates.",
        ],
        [
          "会议记录不等于合同生效或最终授权。",
          "Meeting notes do not constitute contract execution or final approval.",
        ],
      ],
      [
        ["供应商尽调", "Supplier due diligence"],
        [
          "核对经营、履约和利益冲突方面的证据。",
          "Review operating, delivery and conflict-of-interest evidence.",
        ],
        [
          "收集公开登记、资质、联系人及核查日期。",
          "Gather public registration, qualifications, contacts and review dates.",
        ],
        [
          "形成证据目录、风险事项及补充核查。",
          "Produce an evidence index, risks and follow-up checks.",
        ],
        [
          "无法核验的信息应标未知，不可虚构背景。",
          "Mark unverifiable information unknown rather than inventing background.",
        ],
      ],
      [
        ["评标过程留痕", "Evaluation audit trail"],
        [
          "关联评委评分、意见和评标会议记录。",
          "Link evaluator scores, comments and meeting records.",
        ],
        [
          "收集评审时间、参与人、评分版本及回避声明。",
          "Gather review dates, participants, score versions and recusals.",
        ],
        [
          "输出有版本的评标记录与访问范围。",
          "Produce versioned evaluation records and access restrictions.",
        ],
        ["缺席或未签字不得伪造为完成评审。", "Do not fabricate attendance or signatures."],
      ],
      [
        ["定标审批记录", "Award approval record"],
        ["跟踪推荐结果与授权人最终审批。", "Track recommendations and final authorized decisions."],
        [
          "收集推荐依据、备选方案、审批权限及签核。",
          "Gather recommendation evidence, alternatives, delegation and sign-off.",
        ],
        ["输出推荐与已批准状态的区别。", "Distinguish recommendations from approved decisions."],
        [
          "评分第一不自动获得采购授权。",
          "The highest score does not itself authorize procurement.",
        ],
      ],
      [
        ["合同交付节点", "Contract delivery milestones"],
        [
          "把合同订单、交期和验收节点对应起来。",
          "Map contract orders to delivery and acceptance milestones.",
        ],
        [
          "收集合同编号、分批数量、交付日和验收证据。",
          "Gather contract IDs, lot quantities, delivery dates and acceptance evidence.",
        ],
        [
          "输出交付节点、责任及付款前置条件。",
          "Show milestones, ownership and payment prerequisites.",
        ],
        ["验收缺失时不得标为可付款。", "Do not mark payment-ready without acceptance evidence."],
      ],
      [
        ["采购异常登记", "Procurement exception register"],
        [
          "记录流标、超预算、单一来源等例外。",
          "Record failed tenders, budget overruns and sole-source exceptions.",
        ],
        [
          "收集事件原因、影响、审批和替代路径。",
          "Gather causes, impacts, approvals and alternatives.",
        ],
        [
          "输出例外处置、补充证据及关闭状态。",
          "Produce dispositions, supporting evidence and closure status.",
        ],
        [
          "例外审批缺失不得以紧急理由自动放行。",
          "Urgency does not replace required exception approval.",
        ],
      ],
    ],
  }),
  officeFamily({
    id: "supplier-scorecard",
    name: ["供应商绩效", "Supplier performance scorecards"],
    category: "spreadsheet",
    format: "XLSX",
    summary: [
      "用一致的交付、质量与服务证据复核供应商表现",
      "Review supplier delivery, quality and service using consistent evidence",
    ],
    headings: [
      ["评价范围", "Evaluation scope"],
      ["数据来源", "Data sources"],
      ["指标定义", "Metric definitions"],
      ["评分权重", "Scoring weights"],
      ["例外与整改", "Exceptions and corrective action"],
      ["复评决定", "Review decisions"],
    ],
    audience: [
      "采购、质量、供应链和供应商负责人",
      "Procurement, quality, supply-chain and supplier owners",
    ],
    playbook: {
      inputs: [
        "收集供应商主数据、采购订单、承诺与实际交付日、验收数量、缺陷、服务工单、合同和整改记录；注明评价周期、品类、数据截取日及来源。供应商合并、指标缺项和不同服务等级需记录映射与适用边界，并列明数据责任人。",
        "Gather supplier master data, orders, promised and actual delivery dates, accepted quantities, defects, support tickets, contracts and corrective actions. State evaluation period, category, cutoff, sources and data owner; record supplier mappings, missing metrics and service-level differences.",
      ],
      method: [
        "分别定义准时率、缺陷率、响应时效和成本变化的分子、分母与样本范围；按已批准权重计算评分并列示无数据项，不能把空值算成满分。区分不可控延误、供应商原因与客户变更，整改关闭须有验证证据。",
        "Define numerators, denominators and samples for on-time delivery, defects, response and cost changes. Apply approved weights, show missing metrics rather than treating them as perfect, distinguish delay causes, and require evidence before corrective-action closure.",
      ],
      design: [
        "建立订单明细、质量记录、指标参数、评分汇总和整改跟踪表，供应商及订单编号使用文本，保留原始时间戳和状态。汇总列示样本量、期间与权重，筛选和冻结关键列，以文字说明分级，避免仅靠颜色表达风险。",
        "Separate order detail, quality records, metric parameters, score summaries and corrective actions. Keep IDs as text and original timestamps; show sample size, period and weights, freeze and filter key columns, and label ratings without relying on color alone.",
      ],
      checks: [
        "核对订单与验收数量、交付时间和缺陷计数，复查取消订单、部分交付、无样本及评分权重变化；每项整改应有责任人、日期和验证结论。独立核对关键公式及来源，若缺乏审计记录或重算能力，不得宣称评级已批准。",
        "Reconcile order and accepted quantities, dates and defect counts; review cancellations, partial deliveries, zero samples and weight changes. Require owners, dates and evidence for corrective actions, check formulas, and disclose missing evidence or recalculation without claiming approval.",
      ],
    },
    context: {
      focus: [
        "依据评价周期和已批准权重解释供应商表现。",
        "Explain performance using the evaluation period and approved weights.",
      ],
      inputs: [
        "保留供应商编号、样本范围、数据日期和证据来源，补充有效样本数量、例外说明及上次复核结果。",
        "Retain supplier ID, sample scope, date, evidence source, valid sample count, exceptions and previous review results.",
      ],
      output: [
        "列出指标口径、差异原因、责任人及复评计划。",
        "Show metric definitions, causes, owners and the review plan.",
      ],
      risk: [
        "样本不足或缺失不得自动视为合格，评级须经授权确认。",
        "Do not treat insufficient or missing samples as passing; ratings require authorization.",
      ],
    },
    rows: [
      [
        ["准时交付评价", "On-time delivery"],
        [
          "按承诺交期比较实际收货及部分交付。",
          "Compare actual receipt and partial delivery to promised dates.",
        ],
        [
          "收集订单行、承诺日、到货日和数量。",
          "Gather order lines, promised dates, receipt dates and quantities.",
        ],
        ["输出准时率、迟交清单及原因。", "Show on-time rate, late deliveries and reasons."],
        ["改期是否有效须以批准记录确定。", "Determine valid rescheduling from approval records."],
      ],
      [
        ["来料不良分析", "Incoming quality defects"],
        ["按验收批次统计不良数量和缺陷类型。", "Measure defects and categories by receipt lot."],
        [
          "收集批次、抽检数量、不良数及检验记录。",
          "Gather lots, inspected quantities, defects and inspection records.",
        ],
        ["输出不良率、严重问题与批次追踪。", "Show defect rates, severity and lot traceability."],
        [
          "抽检不良率不可直接当作全量不良率。",
          "Sample defect rates do not prove full-population rates.",
        ],
      ],
      [
        ["服务响应表现", "Service response performance"],
        [
          "按工单等级比较首响和解决时间。",
          "Compare first response and resolution by ticket priority.",
        ],
        [
          "收集受理、响应、关闭时间及服务时段。",
          "Gather intake, response, closure and service hours.",
        ],
        ["输出分级时效与超时项目。", "Show tiered timings and breaches."],
        [
          "暂停时钟和非工作时段口径须事先约定。",
          "Define paused clocks and nonworking hours in advance.",
        ],
      ],
      [
        ["整改关闭跟进", "Corrective-action closure"],
        [
          "追踪问题根因、遏制措施和效果验证。",
          "Track root causes, containment and effectiveness checks.",
        ],
        [
          "收集问题单、负责人、完成日和复验证据。",
          "Gather issue IDs, owners, due dates and verification evidence.",
        ],
        ["输出逾期整改及已验证关闭清单。", "Show overdue actions and verified closures."],
        [
          "提交报告不等于问题已经有效关闭。",
          "Submitting a report does not prove effective closure.",
        ],
      ],
      [
        ["评价权重复核", "Scorecard weight review"],
        [
          "检查质量、交付、成本和服务的评分权重。",
          "Review weights for quality, delivery, cost and service.",
        ],
        [
          "收集指标定义、权重、适用类别及批准记录。",
          "Gather definitions, weights, categories and approvals.",
        ],
        ["输出权重合计、版本和变更影响。", "Show weight totals, versions and change impacts."],
        [
          "评分周期内临时改权重须重新授权。",
          "Changing weights during evaluation requires renewed approval.",
        ],
      ],
      [
        ["季度供应商复评", "Quarterly supplier review"],
        [
          "汇总本季度指标、问题和上期整改变化。",
          "Summarize quarterly metrics, issues and prior corrective actions.",
        ],
        [
          "收集季度明细、上期评分和复评会议记录。",
          "Gather quarterly detail, prior scores and review minutes.",
        ],
        ["输出趋势、评级建议和复评待办。", "Show trends, proposed ratings and review actions."],
        [
          "数据口径变化时不能直接比较前后排名。",
          "Do not directly compare rankings after definition changes.",
        ],
      ],
      [
        ["产能与交付能力", "Capacity and delivery capability"],
        [
          "比较确认产能、订单需求与实际交付。",
          "Compare confirmed capacity, orders and actual delivery.",
        ],
        [
          "收集产能周期、可用工时、订单及瓶颈说明。",
          "Gather capacity periods, available hours, orders and bottlenecks.",
        ],
        ["输出缺口、峰值负荷和缓解计划。", "Show shortfalls, peak load and mitigation plans."],
        [
          "未经验证的供应商产能只能标为申报值。",
          "Unverified supplier capacity is supplier-reported only.",
        ],
      ],
      [
        ["单一来源风险", "Single-source dependency"],
        [
          "识别关键物料对单一供应商的依赖程度。",
          "Identify single-supplier dependency for critical materials.",
        ],
        [
          "收集物料、采购占比、替代来源及切换周期。",
          "Gather materials, purchase share, alternatives and switching time.",
        ],
        [
          "输出依赖清单、替代验证和升级事项。",
          "Show dependencies, alternative qualification and escalation.",
        ],
        [
          "候选供应商未经认证不等于可立即替代。",
          "An unqualified candidate is not an immediately available substitute.",
        ],
      ],
      [
        ["采购成本变化", "Supplier cost changes"],
        [
          "比较同规格价格、运输和附加费变化。",
          "Compare like-for-like prices, freight and surcharges.",
        ],
        [
          "收集合同单价、数量阶梯、币种及生效日。",
          "Gather contract prices, volume tiers, currencies and effective dates.",
        ],
        ["输出可比价格差异和驱动解释。", "Show comparable cost changes and drivers."],
        [
          "规格或汇率变化不能全归因供应商涨价。",
          "Do not attribute specification or currency changes entirely to supplier pricing.",
        ],
      ],
      [
        ["供应商投诉归因", "Supplier complaint attribution"],
        [
          "按事件证据区分供应商与内部原因。",
          "Separate supplier and internal causes using incident evidence.",
        ],
        [
          "收集投诉单、批次、影响数量及调查结论。",
          "Gather complaints, lots, affected quantities and findings.",
        ],
        ["输出归因、处理及待确认责任。", "Show attribution, actions and unresolved ownership."],
        [
          "调查未完成不能将全部投诉计入供应商责任。",
          "Do not attribute all complaints before investigation.",
        ],
      ],
      [
        ["合同遵约评估", "Contract compliance review"],
        [
          "核对交期、服务等级和合同约定事项。",
          "Check delivery, service levels and contractual commitments.",
        ],
        [
          "收集合同版本、义务清单及履约证据。",
          "Gather contract versions, obligations and performance evidence.",
        ],
        [
          "输出履约状态、偏差及补救期限。",
          "Show compliance status, deviations and remedy deadlines.",
        ],
        [
          "不得自行判定法律违约或计算未约定罚款。",
          "Do not independently declare legal breach or invent penalties.",
        ],
      ],
      [
        ["淘汰与替补评审", "Supplier exit and replacement review"],
        [
          "比较持续整改、暂停和替换的成本风险。",
          "Compare remediation, suspension and replacement costs and risks.",
        ],
        [
          "收集历史绩效、替代资质、库存及切换成本。",
          "Gather historical performance, alternative qualifications, stock and transition costs.",
        ],
        ["输出候选方案、依赖及授权决策。", "Show options, dependencies and authorized decisions."],
        [
          "尚未批准或未完成切换不能标记淘汰完成。",
          "Do not mark exit complete before approval and transition.",
        ],
      ],
    ],
  }),
  officeFamily({
    id: "inventory-control",
    name: ["库存与仓储控制", "Inventory and warehouse control"],
    category: "spreadsheet",
    format: "XLSX",
    summary: [
      "按物料、批次和库位核对库存、周转及异常",
      "Reconcile inventory, turnover and exceptions by item, lot and location",
    ],
    headings: [
      ["物料及库位", "Items and locations"],
      ["入出库流水", "Inventory movements"],
      ["库存余额", "Stock balances"],
      ["需求与补货", "Demand and replenishment"],
      ["盘点及差异", "Counts and variances"],
      ["异常及处置", "Exceptions and disposition"],
    ],
    audience: [
      "仓库、库存计划和供应链负责人",
      "Warehouse, inventory planning and supply-chain owners",
    ],
    playbook: {
      inputs: [
        "收集物料编码、规格单位、仓库库位、批次及效期、期初余额、入出库流水、在途订单、需求预测和盘点记录，注明截止时间、所有权、可用及冻结状态。条码与编码映射或计量单位不明时标待核对，不改写原始流水。",
        "Gather item IDs, units, warehouse locations, lots and expiry, opening balances, movements, inbound orders, demand forecasts and counts. State cutoff, ownership and available or blocked status; flag unclear codes and units without altering source transactions.",
      ],
      method: [
        "以物料、仓库、库位、批次和单位为粒度，用期初加收入减发出及经批准调整核算期末；将可用、冻结、在途与退货区分。安全库存、周转与库龄按明确期间和业务参数计算，盘盈盘亏经审批后才进入调整建议。",
        "Reconcile opening plus receipts less issues and approved adjustments by item, location, lot and unit. Separate available, blocked, in-transit and returned stock; calculate safety stock, turnover and age using stated periods and parameters, and require approval for count adjustments.",
      ],
      design: [
        "分设物料主数据、原始流水、批次余额、补货参数、盘点及异常工作表，编码保留前导零、日期与数量保持真实类型。明示单位、统计日和盘点范围；冻结表头并按仓库、批次和状态筛选，不用颜色代替库存状态文字。",
        "Separate item master, movements, lot balances, replenishment assumptions, counts and exceptions. Preserve leading zeros and typed dates and quantities; label units, cutoff and count scope, freeze/filter dimensions, and use text as well as color for status.",
      ],
      checks: [
        "核对各粒度期初期末、收发数量和盘点差异，检查负库存、重复流水、单位换算、过期批次及同一在途单重复入账。公式独立抽样并按可用工具重算；缺少实物盘点或库存系统回执时，不得宣称账实一致或实际完成调拨。",
        "Reconcile opening and closing balances, receipts, issues and count differences; inspect negatives, duplicates, unit conversions, expired lots and duplicate transit entries. Review formulas and disclose unavailable recalculation or physical count evidence without claiming stock or transfers are verified.",
      ],
    },
    context: {
      focus: [
        "以物料、仓库、批次和统计截止日明确处理范围。",
        "Define scope by item, warehouse, lot and cutoff.",
      ],
      inputs: [
        "保留数量单位、来源单号、库存状态和责任人，记录库存所有权、冻结原因与数量单位换算依据。",
        "Retain units, source IDs, inventory status, owner, stock ownership, restriction reasons and unit-conversion basis.",
      ],
      output: [
        "列示计算依据、差异明细、处置责任及下一检查日。",
        "Show calculations, differences, disposition owners and next review date.",
      ],
      risk: [
        "未盘点或未批准的库存调整不能视作已经执行。",
        "Do not treat uncounted or unapproved inventory adjustments as executed.",
      ],
    },
    rows: [
      [
        ["安全库存测算", "Safety stock sizing"],
        [
          "结合需求波动与补货提前期估算安全库存。",
          "Estimate safety stock from demand variability and lead time.",
        ],
        [
          "收集历史需求、提前期、服务水平和缺货记录。",
          "Gather demand history, lead time, service target and stockouts.",
        ],
        [
          "输出参数、建议安全量与敏感性。",
          "Show assumptions, recommended safety stock and sensitivity.",
        ],
        [
          "样本不足或异常断货会扭曲需求波动。",
          "Insufficient samples or stockouts can distort demand variability.",
        ],
      ],
      [
        ["缺货预警", "Stockout warnings"],
        [
          "比较可用库存、未来需求与补货到期日。",
          "Compare available stock with demand and inbound dates.",
        ],
        [
          "收集可用量、订单需求、在途数量及预计到货。",
          "Gather available stock, order demand, inbound quantity and arrival dates.",
        ],
        [
          "输出预计缺货日期、数量和补货负责人。",
          "Show projected shortage dates, quantities and owners.",
        ],
        [
          "冻结库存和不确定到货不得当作现货。",
          "Do not count blocked stock or uncertain arrivals as available.",
        ],
      ],
      [
        ["呆滞库存处置", "Slow-moving inventory"],
        [
          "识别长期无消耗的物料及库存占用。",
          "Identify items with prolonged inactivity and carrying exposure.",
        ],
        [
          "收集最近出库日、数量、成本及未来需求。",
          "Gather last issue date, quantity, cost and future demand.",
        ],
        [
          "输出库龄分层和退货、调拨或报废建议。",
          "Show age segments and suggested return, transfer or disposal.",
        ],
        [
          "处置建议未经审批不得视为报废。",
          "Do not treat proposed disposal as approved or executed.",
        ],
      ],
      [
        ["批次效期监控", "Lot expiry monitoring"],
        [
          "按批次到期日排序并识别临期库存。",
          "Prioritize lots by expiry and identify approaching expiry.",
        ],
        [
          "收集批号、生产日、有效期、数量与状态。",
          "Gather lot IDs, production dates, expiry, quantity and status.",
        ],
        [
          "输出临期批次、剩余天数和处置事项。",
          "Show expiring lots, days remaining and disposition actions.",
        ],
        [
          "缺失效期不能默认无限期有效。",
          "Do not assume missing expiry dates mean indefinite validity.",
        ],
      ],
      [
        ["库存ABC分类", "ABC inventory classification"],
        [
          "按选定年消耗金额划分重点管理物料。",
          "Classify items by selected annual consumption value.",
        ],
        [
          "收集年耗量、单位成本、品类及分类阈值。",
          "Gather annual usage, unit cost, category and classification thresholds.",
        ],
        [
          "输出累计金额占比、分类和盘点频次建议。",
          "Show cumulative value share, class and proposed count frequency.",
        ],
        [
          "停产或缺失成本物料应单独复核。",
          "Review discontinued items and missing costs separately.",
        ],
      ],
      [
        ["循环盘点计划", "Cycle count schedule"],
        [
          "按风险、库位和盘点周期安排抽盘。",
          "Schedule cycle counts by risk, location and frequency.",
        ],
        [
          "收集库位、物料分类、上次盘点及盘点能力。",
          "Gather locations, item classes, last counts and counting capacity.",
        ],
        ["输出日程、责任人和复盘覆盖情况。", "Produce schedules, owners and count coverage."],
        ["盘点期间有收发变动必须记录截止点。", "Record movement cutoffs during counting."],
      ],
      [
        ["入库差异核对", "Inbound receipt variance"],
        [
          "比较采购订单、送货和实际验收数量。",
          "Compare purchase orders, delivery and accepted quantities.",
        ],
        [
          "收集订单行、送货单、实收量及拒收原因。",
          "Gather order lines, delivery notes, received quantities and rejection reasons.",
        ],
        ["输出短收、超收及待处理单据。", "Show shortages, overages and open documents."],
        [
          "未验收数量不得自动计为可用库存。",
          "Do not automatically treat unaccepted items as available.",
        ],
      ],
      [
        ["出库差错复核", "Outbound picking errors"],
        [
          "核对拣货、发运与订单行的数量和物料。",
          "Compare picked and shipped quantities and items with orders.",
        ],
        [
          "收集订单、拣货记录、发运单及扫描异常。",
          "Gather orders, pick records, shipment documents and scan exceptions.",
        ],
        ["输出错发漏发差异及纠正责任。", "Show mispicks, shortages and corrective ownership."],
        [
          "订单取消和补发不可重复扣减库存。",
          "Do not deduct stock twice for cancellations or replacements.",
        ],
      ],
      [
        ["库位容量分析", "Location capacity"],
        [
          "按库位容积及物料单位评估剩余容量。",
          "Assess location capacity using dimensions and item units.",
        ],
        [
          "收集库位尺寸、包装规格、现存数量与限制。",
          "Gather location dimensions, pack sizes, stock and constraints.",
        ],
        ["输出容量利用、超限及调整建议。", "Show utilization, overcapacity and proposed changes."],
        [
          "危险品隔离和承重限制不可仅靠体积判断。",
          "Volume alone does not establish hazardous-goods or weight compliance.",
        ],
      ],
      [
        ["在途库存核对", "Inventory in transit"],
        [
          "匹配已发货未入库和仓间调拨两端。",
          "Match shipped-not-received items and both sides of transfers.",
        ],
        [
          "收集运输单号、发出日、预计到达和接收状态。",
          "Gather shipment IDs, dispatch, estimated arrival and receipt status.",
        ],
        ["输出在途账龄、未匹配记录和责任人。", "Show transit age, unmatched records and owners."],
        ["收货后须及时消除重复在途数量。", "Remove duplicate transit quantities after receipt."],
      ],
      [
        ["库存周转评估", "Inventory turnover"],
        [
          "按可比期间比较消耗成本与平均库存。",
          "Compare consumption cost with average inventory over a consistent period.",
        ],
        [
          "收集期初期末或月均库存成本及期间消耗。",
          "Gather opening, closing or monthly inventory costs and period consumption.",
        ],
        ["输出周转次数、天数和统计口径。", "Show turns, days and measurement definitions."],
        [
          "平均库存为零或成本缺失时不可计算；零消耗且平均库存大于零时周转次数为零、天数不可计算。",
          "With zero average inventory or missing costs the calculation is unavailable; zero consumption with positive average inventory yields zero turns and undefined days.",
        ],
      ],
      [
        ["退货回库跟踪", "Returns to inventory"],
        [
          "区分客户退货收货、检验和重新上架。",
          "Separate returned-goods receipt, inspection and restocking.",
        ],
        [
          "收集退货授权、批次、数量、检验和库位。",
          "Gather return authorization, lot, quantity, inspection and location.",
        ],
        [
          "输出待检、合格入库及不可用数量。",
          "Show pending inspection, accepted and unusable quantities.",
        ],
        ["未检退货不得直接并入可售库存。", "Do not include uninspected returns in sellable stock."],
      ],
    ],
  }),
  officeFamily({
    id: "sales-forecast",
    name: ["销售预测与管道", "Sales forecasting and pipeline"],
    category: "spreadsheet",
    format: "XLSX",
    summary: [
      "依据商机、订单、续约及销售产能建立可复核预测",
      "Build reviewable forecasts from opportunities, orders, renewals and sales capacity",
    ],
    headings: [
      ["预测范围", "Forecast scope"],
      ["商机与订单", "Opportunities and orders"],
      ["阶段与概率", "Stages and probabilities"],
      ["预测假设", "Forecast assumptions"],
      ["预测及差异", "Forecast and variance"],
      ["行动与复盘", "Actions and review"],
    ],
    audience: [
      "销售运营、区域经理和财务计划人员",
      "Sales operations, regional managers and financial planners",
    ],
    playbook: {
      inputs: [
        "收集商机编号、客户、产品、区域、阶段、金额、预计签约及交付日期、负责人、订单和历史成交记录，保留预测快照日期、币种及来源版本。续约、退款与取消单独标记，记录实际数据截止时点，缺失概率或日期不得凭空补成事实。",
        "Gather opportunity IDs, customers, products, regions, stages, amounts, expected close and delivery dates, owners, orders and historical wins. Preserve snapshot date, actual cutoff, currency and source version, mark renewals and cancellations, and do not invent probabilities or dates.",
      ],
      method: [
        "按已定义阶段或历史队列计算加权管道，区分报价、已签订单和收入确认，明确概率、周期、汇率及交付假设的有效期。对基准、延迟和乐观情景只调整可见驱动，历史准确率与当前预测采用同一快照和比较周期。",
        "Calculate weighted pipeline using defined stages or historical cohorts, separating quotes, signed orders and recognized revenue. Date probability, cycle, currency and delivery assumptions; change visible drivers across scenarios and compare accuracy using matching snapshots and periods.",
      ],
      design: [
        "设置商机明细、历史快照、阶段概率、续约计划、预测汇总和误差复盘工作表；编号保留文本，金额按币种与期间显示，输入及公式用文字图例区分。按区域、产品与负责人筛选，并显示预测更新时间及实际数据截止日。",
        "Separate opportunities, historical snapshots, stage probabilities, renewals, forecast summary and error review. Keep identifiers as text, label amounts by currency and period, distinguish inputs and formulas, and filter by region, product and owner with snapshot and actual cutoffs.",
      ],
      checks: [
        "抽查重复商机、阶段倒退、日期跨期、无概率、负金额、重复续约和相同订单多次认领；汇总结果应勾稽明细并与已签合同分别列示。独立核对关键公式和分母，未实际重算、缺少历史样本或客户确认时清楚披露。",
        "Inspect duplicate opportunities, stage reversals, period shifts, missing probabilities, negative amounts and duplicate renewals or orders. Reconcile details and distinguish signed contracts; review formulas and denominators, disclosing missing history, customer confirmation or recalculation.",
      ],
    },
    context: {
      focus: [
        "区分预测快照、商机阶段和实际签约状态。",
        "Distinguish forecast snapshot, opportunity stage and actual signature status.",
      ],
      inputs: [
        "保留商机编号、负责人、金额、币种及数据截止日，区分快照日期、已签合同和预计关闭日期。",
        "Retain opportunity ID, owner, amount, currency and cutoff, distinguishing snapshot date, signed contracts and expected close dates.",
      ],
      output: [
        "列出可追溯假设、预测明细、差异和跟进行动。",
        "Show traceable assumptions, forecast detail, variances and follow-up actions.",
      ],
      risk: [
        "预测概率不是合同承诺，未经确认的金额不能视作收入。",
        "A forecast probability is not a contract and unconfirmed amounts are not revenue.",
      ],
    },
    rows: [
      [
        ["商机阶段预测", "Stage-weighted opportunities"],
        [
          "按已批准阶段概率计算加权签约金额。",
          "Calculate weighted bookings using approved stage probabilities.",
        ],
        [
          "收集阶段、商机金额、预计签约日及概率版本。",
          "Gather stage, amount, expected close date and probability version.",
        ],
        ["输出阶段管道和加权预测。", "Show pipeline and weighted forecast by stage."],
        [
          "缺失概率应标未知而不是自动设为零。",
          "Mark missing probabilities unknown rather than zero.",
        ],
      ],
      [
        ["销售漏斗转化", "Sales funnel conversion"],
        [
          "比较同一来源队列的阶段转换与流失。",
          "Compare stage conversion and loss for a consistent cohort.",
        ],
        [
          "收集进入阶段日期、来源渠道、成功和流失状态。",
          "Gather stage-entry dates, acquisition source and win/loss status.",
        ],
        [
          "输出各阶段分母、转化率和停留时间。",
          "Show denominators, conversion and dwell time by stage.",
        ],
        [
          "不同月份截面不能直接当作同批次转化。",
          "Different monthly snapshots are not automatically one cohort.",
        ],
      ],
      [
        ["区域月度预测", "Regional monthly forecast"],
        [
          "按区域及负责人汇总未来月份销售机会。",
          "Aggregate expected sales by region and owner for each month.",
        ],
        [
          "收集区域归属、预计签约月、金额与负责人。",
          "Gather regional ownership, expected close month, amount and owner.",
        ],
        ["输出各月预测、目标差距和变动解释。", "Show monthly forecasts, target gaps and changes."],
        [
          "区域调整要保留历史归属避免重复计数。",
          "Preserve historical assignments when regions change.",
        ],
      ],
      [
        ["渠道销售预测", "Channel sales forecast"],
        [
          "按直销和合作伙伴渠道比较预测贡献。",
          "Compare forecast contribution from direct and partner channels.",
        ],
        [
          "收集渠道、合作伙伴、商机编号和归属规则。",
          "Gather channels, partners, opportunity IDs and attribution rules.",
        ],
        [
          "输出渠道预测、交叉归属与负责人。",
          "Show channel forecasts, overlapping attribution and owners.",
        ],
        [
          "同一交易不可在直销与伙伴两边重复计入。",
          "Do not double count one deal across direct and partner channels.",
        ],
      ],
      [
        ["合同续约预测", "Renewal forecast"],
        [
          "按到期合同与续约状态估算未来续约。",
          "Forecast renewals by contract expiry and renewal status.",
        ],
        [
          "收集合同期限、现有金额、续约概率与客户意向。",
          "Gather contract term, current amount, renewal probability and intent.",
        ],
        ["输出到期清单、预计续约额及风险。", "Show expirations, expected renewals and risks."],
        [
          "未确认自动续约条款不得视为已经续约。",
          "Do not assume renewal without confirmed contract terms.",
        ],
      ],
      [
        ["新客获客预测", "New-customer acquisition"],
        [
          "根据线索量和历史队列转化预测新客户。",
          "Forecast new customers using leads and historical cohort conversion.",
        ],
        [
          "收集线索来源、合格率、成交周期和历史客户数。",
          "Gather lead source, qualification, sales cycle and historical customer counts.",
        ],
        [
          "输出客户数及金额预测与样本范围。",
          "Show customer and value forecasts with sample scope.",
        ],
        [
          "样本不足或定义改变时不能外推稳定转化率。",
          "Do not extrapolate stable conversion from weak or changed samples.",
        ],
      ],
      [
        ["存量客户扩容", "Existing-customer expansion"],
        [
          "跟踪现有客户增购、升级及收缩机会。",
          "Track upsell, expansion and contraction in existing accounts.",
        ],
        [
          "收集客户现有合同、增购机会、金额和预计日期。",
          "Gather existing contracts, expansion opportunities, value and dates.",
        ],
        ["输出净扩容量及与续约的关联。", "Show net expansion and links to renewals."],
        [
          "续约基数和新增金额不得重复相加。",
          "Do not double count renewal base and incremental expansion.",
        ],
      ],
      [
        ["订单交付时点", "Order delivery timing"],
        [
          "按合同交付节点安排签单后的履约预测。",
          "Schedule post-booking delivery using contract milestones.",
        ],
        [
          "收集订单号、分批数量、交付日与验收条件。",
          "Gather order IDs, staged quantities, delivery dates and acceptance terms.",
        ],
        [
          "输出月份交付计划及未确认节点。",
          "Show monthly delivery plans and unconfirmed milestones.",
        ],
        [
          "签约金额不能直接等同当期确认收入。",
          "Booked value is not automatically current-period revenue.",
        ],
      ],
      [
        ["季度冲刺机会", "Quarter-end pipeline"],
        [
          "识别季度末潜在成交和需协调事项。",
          "Identify quarter-end opportunities and coordination needs.",
        ],
        [
          "收集预计签约日、审批依赖、客户确认和阻塞。",
          "Gather expected close date, approval dependencies, customer confirmation and blockers.",
        ],
        ["输出冲刺清单、责任和跨期影响。", "Show close plans, owners and period-shift impacts."],
        [
          "不得为达目标提前确认尚未签订的合同。",
          "Do not recognize unsigned deals early to meet targets.",
        ],
      ],
      [
        ["销售预测偏差", "Forecast accuracy review"],
        [
          "比较历史快照预测与对应期间实际。",
          "Compare historical snapshot forecasts to actuals for the same period.",
        ],
        [
          "收集快照日期、预测金额、实际订单和调整原因。",
          "Gather snapshot dates, forecast amounts, actual orders and reasons.",
        ],
        ["输出绝对误差、偏差率及主要驱动。", "Show absolute error, bias and key drivers."],
        ["实际为零时比例误差不可简单除零。", "Do not divide by zero when actuals are zero."],
      ],
      [
        ["产品组合预测", "Product mix forecast"],
        ["按产品和价格组合测算未来销售额。", "Forecast sales by product and price mix."],
        [
          "收集产品数量、折扣、价格版本及交付月份。",
          "Gather product quantities, discounts, price versions and delivery months.",
        ],
        ["输出数量、净价和组合变化影响。", "Show quantities, net prices and mix effects."],
        [
          "产品替代或退货假设缺失须单列。",
          "Separately flag missing substitution or return assumptions.",
        ],
      ],
      [
        ["销售产能覆盖", "Sales capacity coverage"],
        [
          "比较团队可覆盖商机与目标所需产能。",
          "Compare sales capacity with opportunities and target requirements.",
        ],
        [
          "收集销售人数、有效工作日、周期及人均产出。",
          "Gather sales headcount, working days, cycle and productivity.",
        ],
        [
          "输出产能缺口、覆盖假设及调整建议。",
          "Show capacity gaps, assumptions and proposed actions.",
        ],
        [
          "新人爬坡及休假不能简单按满产计算。",
          "Do not assume full productivity during ramp-up or leave.",
        ],
      ],
    ],
  }),
  officeFamily({
    id: "project-cost-control",
    name: ["项目成本控制", "Project cost control"],
    category: "spreadsheet",
    format: "XLSX",
    summary: [
      "按项目基线、承诺、实际和变更跟踪完工成本",
      "Track project baseline, commitments, actuals, changes and cost at completion",
    ],
    headings: [
      ["范围与基线", "Scope and baseline"],
      ["费用与工时", "Costs and labor"],
      ["采购承诺", "Purchase commitments"],
      ["变更记录", "Change records"],
      ["完工预测", "Estimate at completion"],
      ["差异及审批", "Variances and approvals"],
    ],
    audience: [
      "项目经理、项目财务和采购负责人",
      "Project managers, project finance and procurement owners",
    ],
    playbook: {
      inputs: [
        "收集项目和工作包编号、批准预算基线、合同、采购订单、工时、发票、付款、变更单及完工进度，记录统计截止日、币种、税费口径和来源版本。区分已批准、申请中和仅预测的事项，缺失费率或验收证据时保留待确认。",
        "Gather project and work-package IDs, approved baseline, contracts, purchase orders, labor, invoices, payments, change orders and progress. Record cutoff, currency, tax basis and source version; distinguish approved, pending and forecast items and leave missing rates or acceptance unresolved.",
      ],
      method: [
        "按工作包归集实际成本、未履行采购承诺和剩余工作估算，确保同一订单的发票与承诺释放相互对应，避免重复计入。完工预测等于已发生成本加剩余估算，预算调整只采用批准变更；付款计划与权责成本分别展示。",
        "Group actual costs, unfulfilled commitments and remaining estimates by work package, releasing commitments against corresponding invoices to avoid double counting. Estimate at completion is actual cost plus estimate to complete; only approved changes alter baseline and cash schedules stay separate.",
      ],
      design: [
        "建立基线预算、合同与承诺、工时实际、变更、完工预测、付款计划和差异核对工作表；工作包和单据编号保留文本，单位与币种清晰标识。输入、公式、批准状态使用文字标记，并冻结关键列以便项目团队逐项复核。",
        "Separate baseline, contracts and commitments, actual labor, changes, completion forecast, payment schedule and reconciliation. Keep work-package and document IDs as text, label units and currency, distinguish inputs, formulas and approvals, and freeze key columns for review.",
      ],
      checks: [
        "核对总预算、工作包汇总、承诺释放和实际发票，抽查重复工时、已取消采购、跨期预提、变更审批及完工率口径。独立检查剩余估算和偏差公式；未取得合同、付款回执或公式重算时披露限制，不以计划冒充已付款。",
        "Reconcile budget, work packages, commitment releases and actual invoices; inspect duplicate hours, cancellations, accrual cutoffs, change approvals and progress measures. Review remaining estimates and variance formulas, disclosing missing contracts, payment evidence or recalculation.",
      ],
    },
    context: {
      focus: [
        "按项目工作包、批准基线与截止日区分成本状态。",
        "Distinguish costs by work package, approved baseline and cutoff.",
      ],
      inputs: [
        "保留合同或凭证编号、金额、币种、责任人和来源版本，并记录预算批准版本、承诺金额及变更状态。",
        "Retain contract or document IDs, amount, currency, owner and source version, approved budget version, commitment and change status.",
      ],
      output: [
        "列出预算、实际、预测及差异处理责任和待决事项。",
        "Show budget, actual, forecast, variance owners and open issues.",
      ],
      risk: [
        "未批准变更和未证实付款不得当成已生效或已支付。",
        "Do not treat unapproved changes or unverified payments as effective or paid.",
      ],
    },
    rows: [
      [
        ["合同预算基线", "Contract budget baseline"],
        [
          "按工作包建立批准预算和合同范围。",
          "Establish an approved budget and contract scope by work package.",
        ],
        [
          "收集合同总额、成本科目、预算版本和授权人。",
          "Gather contract value, cost categories, budget version and approver.",
        ],
        ["输出工作包基线及未分配预算。", "Show work-package baselines and unallocated budget."],
        [
          "未签署变更不得静默修改原始基线。",
          "Do not silently change the original baseline for unsigned changes.",
        ],
      ],
      [
        ["承包商结算", "Contractor settlement"],
        [
          "对照合同及验收核算承包商阶段款。",
          "Calculate contractor installments against contract and acceptance.",
        ],
        [
          "收集合同金额、阶段成果、验收单和已结金额。",
          "Gather contract amount, milestones, acceptance and prior settlements.",
        ],
        [
          "输出本期结算、累计金额及扣留款。",
          "Show current and cumulative settlement and retention.",
        ],
        ["未验收或重复结算项目须保留异常。", "Flag unaccepted or duplicate settlement items."],
      ],
      [
        ["工时实际成本", "Actual labor costs"],
        [
          "按角色和工作包归集实际工时成本。",
          "Accumulate actual labor cost by role and work package.",
        ],
        [
          "收集工时单、成本费率、日期和项目编码。",
          "Gather timesheets, cost rates, dates and project IDs.",
        ],
        ["输出人工成本及缺失费率清单。", "Show labor costs and missing-rate items."],
        [
          "重复工时或跨项目分摊超过实际须复核。",
          "Review duplicate hours and allocations above actual hours.",
        ],
      ],
      [
        ["已发生成本归集", "Actual project costs"],
        [
          "汇总凭证、应计和经确认实际费用。",
          "Aggregate posted, accrued and confirmed actual costs.",
        ],
        [
          "收集总账凭证、发票、应计和工作包映射。",
          "Gather ledger entries, invoices, accruals and work-package mappings.",
        ],
        ["输出分项实际成本与总账差异。", "Show actual costs and differences to the ledger."],
        [
          "已冲回预提不能再次叠加正式发票。",
          "Do not double count reversed accruals and final invoices.",
        ],
      ],
      [
        ["完工成本预测", "Estimate at completion"],
        [
          "按已发生金额与剩余工作量预测完工成本。",
          "Forecast completion cost from actuals and remaining work.",
        ],
        [
          "收集实际成本、剩余工作量、费率及完工假设。",
          "Gather actuals, remaining effort, rates and completion assumptions.",
        ],
        [
          "输出完工预测、预算偏差和敏感项。",
          "Show completion estimate, budget variance and sensitivities.",
        ],
        [
          "进度百分比没有证据时不得直接外推。",
          "Do not extrapolate progress percentages without evidence.",
        ],
      ],
      [
        ["项目变更单控制", "Project change orders"],
        [
          "跟踪范围变更对预算、工期及责任的影响。",
          "Track scope-change effects on budget, schedule and ownership.",
        ],
        [
          "收集变更编号、影响金额、状态及签批。",
          "Gather change IDs, cost impacts, status and sign-off.",
        ],
        ["输出已批、待批及预测影响分栏。", "Separate approved, pending and forecast impacts."],
        ["待批金额不能直接改写批准预算。", "Pending amounts must not change approved budget."],
      ],
      [
        ["采购承诺追踪", "Purchase commitment tracking"],
        [
          "跟踪采购订单未履行金额及实际释放。",
          "Track outstanding purchase commitments and releases.",
        ],
        [
          "收集订单、合同金额、发票、取消和剩余交付。",
          "Gather orders, contract values, invoices, cancellations and remaining delivery.",
        ],
        [
          "输出未履行承诺及对应实际费用。",
          "Show unfulfilled commitments and related actual costs.",
        ],
        [
          "发票已入账的部分不可与完整承诺重复计算。",
          "Do not double count invoiced portions and full commitments.",
        ],
      ],
      [
        ["跨期费用预提", "Project cost accruals"],
        [
          "按服务发生期间估计尚未开票的费用。",
          "Estimate uninvoiced services in the period performed.",
        ],
        [
          "收集服务期、验收进度、合同费率及冲回记录。",
          "Gather service periods, progress, contract rates and reversals.",
        ],
        ["输出预提金额、依据和下期冲回。", "Show accruals, support and next-period reversals."],
        [
          "预提与后续发票重复时需调整差额。",
          "Adjust differences when subsequent invoices duplicate accruals.",
        ],
      ],
      [
        ["里程碑付款计划", "Milestone payment schedule"],
        ["按照合同节点安排预计付款时间。", "Schedule expected payments by contractual milestones."],
        [
          "收集节点金额、验收条件、到期日与付款回执。",
          "Gather milestone amounts, acceptance conditions, due dates and receipts.",
        ],
        [
          "输出待验收、待支付和已支付状态。",
          "Show pending acceptance, pending payment and paid status.",
        ],
        ["到期计划不能等同银行已支付。", "A due schedule is not proof of bank payment."],
      ],
      [
        ["成本偏差解释", "Project cost variances"],
        [
          "分析工作包实际及预测相对基线的差异。",
          "Analyze actual and forecast variance to baseline by work package.",
        ],
        [
          "收集基线、实际、剩余估算和差异原因。",
          "Gather baseline, actuals, estimates to complete and explanations.",
        ],
        ["输出超支驱动、责任及纠正计划。", "Show overspend drivers, owners and corrective plans."],
        [
          "预算为零时比例差异须标不可计算。",
          "Mark percentage variance uncomputable when baseline is zero.",
        ],
      ],
      [
        ["项目现金支付计划", "Project cash payment plan"],
        [
          "按合同和审批安排未来现金支付。",
          "Schedule future cash payments by contract and approval.",
        ],
        [
          "收集付款条款、预计日期、金额及现金约束。",
          "Gather payment terms, expected dates, amounts and cash constraints.",
        ],
        [
          "输出分期资金需求和待确认付款。",
          "Show funding needs by period and unconfirmed payments.",
        ],
        [
          "现金支付日期与费用确认期不可混同。",
          "Do not conflate cash dates and expense recognition periods.",
        ],
      ],
      [
        ["项目收尾成本核查", "Project closeout cost review"],
        [
          "检查未结合同、保留金和尾项成本。",
          "Review open contracts, retention and closeout costs.",
        ],
        [
          "收集最终验收、未付发票、担保及剩余承诺。",
          "Gather final acceptance, unpaid invoices, guarantees and commitments.",
        ],
        [
          "输出收尾余额、责任和关闭条件。",
          "Show closeout balances, owners and closure conditions.",
        ],
        [
          "未完成验收或争议款不能强制归零。",
          "Do not force unresolved acceptance or disputes to zero.",
        ],
      ],
    ],
  }),
  officeFamily({
    id: "powerbi-metric-spec",
    name: ["Power BI 指标与看板规格", "Power BI metric and dashboard specification"],
    category: "document",
    format: "DOCX",
    summary: [
      "编写可交接的指标、模型、页面和验收规格，不生成原生报表",
      "Document metrics, model, pages and acceptance criteria without producing a native report",
    ],
    headings: [
      ["业务目标", "Business objectives"],
      ["指标字典", "Metric dictionary"],
      ["数据与关系", "Data and relationships"],
      ["页面与交互", "Pages and interactions"],
      ["权限与刷新", "Access and refresh"],
      ["验收样例", "Acceptance examples"],
    ],
    audience: [
      "业务指标负责人、数据分析师和报表实施人员",
      "Business metric owners, analysts and report implementers",
    ],
    playbook: {
      inputs: [
        "收集业务决策问题、源表字段、主键、数据粒度、刷新时间、用户角色、现有指标定义及样例记录，标注版本和业务负责人。确认是否存在迟到数据、历史重算、时区与数据使用授权，缺失源数据不得编造结果。",
        "Gather business decisions, source fields, keys, grain, refresh timing, roles, existing metric definitions and sample records with versions and owners. Confirm late data, historical restatement, time zones and data authorization; never invent unavailable results.",
      ],
      method: [
        "逐指标描述业务含义、分子分母、过滤条件、时间窗口、去重键、空值及币种；绘制事实表与维度表关系，明确基数、日期角色和过滤方向。列出页面、筛选、钻取、权限和刷新验收用例，涉及实现的表达式须以实际环境验证。",
        "Define meaning, numerator, denominator, filters, time window, deduplication key, nulls and currency for each metric. Describe fact/dimension relationships, cardinality, date roles and filter direction; specify pages, drill-through, access and refresh tests and verify implementation expressions in the target environment.",
      ],
      design: [
        "交付可编辑的文档规格，使用清晰标题和表格组织指标字典、源字段映射、关系说明、页面线框描述、权限矩阵和验收样例；写明负责人、版本与未决项。此文件不是可直接打开的原生报表，也不代表模型或服务已经部署。",
        "Deliver an editable document with headings and tables for metrics, source mappings, relationships, page descriptions, permission matrices and acceptance examples. State ownership, version and open issues. The document is not a native report and does not imply a deployed model or service.",
      ],
      checks: [
        "核对每个指标与源字段、时间粒度、过滤条件和示例预期结果，检查重复关系、多对多歧义、跨时区日期与权限越界。仅在实际环境可用时验证表达式、刷新或权限；不能把规格审阅当成原生报表运行、发布或安全测试通过。",
        "Trace each metric to source fields, grain, filters and expected example results; inspect ambiguous relationships, many-to-many joins, time zones and access boundaries. Verify expressions, refresh and permissions only in a real environment; a reviewed specification is not a deployed or security-tested report.",
      ],
    },
    context: {
      focus: [
        "明确业务决策、指标所有者和适用数据粒度。",
        "Identify the business decision, metric owner and data grain.",
      ],
      inputs: [
        "保留源表字段、版本、时间窗口和样例来源，补充源表数据质量、指标更新频率及不同角色的访问假设。",
        "Retain source fields, versions, time windows and sample provenance, plus source quality, metric refresh frequency and role-access assumptions.",
      ],
      output: [
        "交付文档中的定义、映射、验收例子及未决事项。",
        "Deliver documented definitions, mappings, acceptance examples and open issues.",
      ],
      risk: [
        "文档不代表已生成、发布或验证原生 Power BI 报表。",
        "Documentation does not mean a native Power BI report was generated, published or validated.",
      ],
    },
    rows: [
      [
        ["指标字典规格", "Metric dictionary"],
        [
          "定义指标名称、公式、口径和责任人。",
          "Define metric names, formulas, definitions and owners.",
        ],
        [
          "收集业务术语、源字段、单位和计算窗口。",
          "Gather business terms, source fields, units and calculation windows.",
        ],
        ["输出指标字典与术语映射。", "Produce a metric dictionary and terminology map."],
        [
          "同名不同口径必须拆分并注明版本。",
          "Separate same-name metrics with different definitions and versions.",
        ],
      ],
      [
        ["销售额指标口径", "Sales amount definition"],
        [
          "明确订单、退货、税额和折扣如何计入。",
          "Define inclusion of orders, returns, tax and discounts.",
        ],
        [
          "收集订单行、退货单、币种、税率及日期字段。",
          "Gather order lines, returns, currencies, tax and date fields.",
        ],
        ["输出净销售额规则和边界样例。", "Produce net-sales rules and boundary examples."],
        ["签单额与确认收入不得混为同一指标。", "Do not conflate bookings and recognized revenue."],
      ],
      [
        ["客户活跃指标口径", "Active customer definition"],
        [
          "定义活跃事件、观察窗口和去重规则。",
          "Define qualifying activity, observation window and deduplication.",
        ],
        [
          "收集客户键、事件时间、事件类型和时区。",
          "Gather customer keys, event times, event types and time zone.",
        ],
        ["输出活跃客户定义与例外样例。", "Show the active-customer definition and edge cases."],
        [
          "测试账户和重复身份需明确排除规则。",
          "Define exclusions for test accounts and duplicate identities.",
        ],
      ],
      [
        ["维度关系规格", "Dimension relationship specification"],
        ["描述事实表、维表及可过滤路径。", "Describe fact tables, dimensions and filter paths."],
        [
          "收集主外键、表粒度、唯一性及缺失键。",
          "Gather primary and foreign keys, table grains, uniqueness and missing keys.",
        ],
        ["输出关系基数、方向和未匹配样例。", "Show cardinality, direction and unmatched examples."],
        [
          "多对多关系可能放大金额，须明确验证。",
          "Many-to-many relationships can inflate amounts and require validation.",
        ],
      ],
      [
        ["刷新时效规格", "Data refresh requirements"],
        [
          "定义刷新频率、延迟容忍和失败通知。",
          "Define refresh cadence, latency tolerance and failure notification.",
        ],
        [
          "收集源系统更新时间、依赖链、窗口和责任人。",
          "Gather source updates, dependencies, windows and owners.",
        ],
        [
          "输出刷新时序、监控与失败处置要求。",
          "Produce refresh timing, monitoring and failure-response requirements.",
        ],
        [
          "规格不代表刷新任务已经配置或成功运行。",
          "A specification does not prove refresh is configured or successful.",
        ],
      ],
      [
        ["行级权限矩阵", "Row-level access matrix"],
        [
          "按角色规定可见区域、客户或组织范围。",
          "Specify visible regions, customers or entities by role.",
        ],
        [
          "收集角色、身份映射、组织层级与权限例外。",
          "Gather roles, identity mappings, hierarchy and access exceptions.",
        ],
        ["输出允许与拒绝样例及复核责任。", "Show allowed and denied examples with reviewers."],
        [
          "文档矩阵不等于实际权限策略已经启用。",
          "A documented matrix does not mean access controls are enabled.",
        ],
      ],
      [
        ["钻取路径规格", "Drill-through paths"],
        [
          "定义从汇总指标到明细的导航及上下文。",
          "Define navigation and context from summary metrics to detail.",
        ],
        [
          "收集起点指标、目标页面、过滤字段和用户任务。",
          "Gather source metrics, target pages, filter fields and user tasks.",
        ],
        [
          "输出导航路径及筛选传递验收例子。",
          "Show paths and filter-propagation acceptance examples.",
        ],
        [
          "明细页面需要独立检查敏感字段访问范围。",
          "Check access to sensitive fields on detail pages independently.",
        ],
      ],
      [
        ["过滤器交互规格", "Filter interaction specification"],
        [
          "明确日期、区域和产品筛选的作用范围。",
          "Define the scope of date, region and product filters.",
        ],
        [
          "收集页面布局、筛选默认值与跨图表关系。",
          "Gather page layouts, filter defaults and cross-visual relationships.",
        ],
        [
          "输出交互矩阵和重置后的预期状态。",
          "Produce an interaction matrix and expected reset state.",
        ],
        [
          "隐式筛选和未同步页面可能造成数值误读。",
          "Hidden filters and unsynchronized pages can mislead users.",
        ],
      ],
      [
        ["经营例会页面规格", "Operating review page"],
        [
          "定义管理例会的指标层级和追问顺序。",
          "Define metric hierarchy and follow-up flow for operating reviews.",
        ],
        [
          "收集会议决策、负责人、指标与比较期间。",
          "Gather meeting decisions, owners, metrics and comparison periods.",
        ],
        [
          "输出页面区块、数据说明和行动关联。",
          "Describe page regions, data notes and linked actions.",
        ],
        [
          "视觉布局建议不能替代实际可读性验收。",
          "Layout recommendations do not replace actual usability checks.",
        ],
      ],
      [
        ["异常阈值规格", "Exception threshold definition"],
        [
          "规定指标偏离目标后的提示和升级。",
          "Define alerts and escalation when metrics deviate from targets.",
        ],
        [
          "收集目标值、阈值、方向、责任人与冷却期。",
          "Gather targets, thresholds, direction, owners and cooldown periods.",
        ],
        [
          "输出阈值规则、触发样例和响应责任。",
          "Show thresholds, trigger examples and response owners.",
        ],
        [
          "阈值未经业务批准不得视为自动触发。",
          "Do not assume unapproved thresholds are active alerts.",
        ],
      ],
      [
        ["历史口径切换", "Historical metric definition changes"],
        [
          "记录指标版本变化及历史期间比较方式。",
          "Document metric version changes and historical comparability.",
        ],
        [
          "收集生效日期、旧新公式、重算范围与审批。",
          "Gather effective dates, old and new formulas, restatement scope and approvals.",
        ],
        ["输出版本时间线及新旧对照样例。", "Produce a version timeline and comparison examples."],
        [
          "未重算历史不能与新口径直接混比。",
          "Do not mix unrevised history with new definitions without disclosure.",
        ],
      ],
      [
        ["指标验收样例", "Metric acceptance examples"],
        [
          "构造正常、空值、重复和边界日期测试。",
          "Design tests for normal, null, duplicate and boundary-date cases.",
        ],
        [
          "收集可授权样例行、预期值和业务解释。",
          "Gather authorized sample rows, expected values and business explanations.",
        ],
        [
          "输出输入样例、手算过程和预期结果。",
          "Show sample inputs, independent calculations and expected results.",
        ],
        [
          "样例通过不等于完整生产数据已验证。",
          "Passing examples do not establish full production-data validation.",
        ],
      ],
    ],
  }),
  officeFamily({
    id: "access-data-register",
    name: ["Access 数据台账方案", "Access data register design"],
    category: "spreadsheet",
    format: "XLSX",
    summary: [
      "提供数据字典、关系和导入映射工作簿，不生成原生数据库",
      "Provide a data dictionary, relationship and import-mapping workbook, not a native database",
    ],
    headings: [
      ["业务范围", "Business scope"],
      ["表与字段", "Tables and fields"],
      ["主键及关系", "Keys and relationships"],
      ["导入映射", "Import mapping"],
      ["校验规则", "Validation rules"],
      ["迁移及验收", "Migration and acceptance"],
    ],
    audience: [
      "台账管理员、业务负责人和数据库实施人员",
      "Register administrators, business owners and database implementers",
    ],
    playbook: {
      inputs: [
        "收集现有表格、业务字段、记录粒度、唯一标识、实体关系、样例数据及导入来源，注明日期格式、编码、敏感级别和维护责任人。识别重复主键、空值和历史口径变化，未经授权不复制个人身份、账户或合同明细。",
        "Gather existing spreadsheets, business fields, row grain, unique identifiers, relationships, sample data and import sources. State date formats, encodings, sensitivity and owners; identify duplicate keys, missing values and historical changes without copying unauthorized personal or commercial data.",
      ],
      method: [
        "按实体划分主表、关联表与状态字典，逐字段定义名称、业务含义、数据类型、长度、必填、默认值、唯一性和允许值；列明主外键、关系基数及导入前清洗规则。对重复、无父记录和非法日期设计隔离与人工处置流程。",
        "Separate master, related and status entities; specify field names, meanings, types, lengths, required/default values, uniqueness and allowed values. Document primary/foreign keys, cardinality and pre-import cleansing, including quarantine and review for duplicates, orphan records and invalid dates.",
      ],
      design: [
        "交付可编辑的 XLSX 方案，分别建立实体清单、字段字典、关系矩阵、源到目标映射、脱敏样例和导入验收工作表；编号保留文本，表头可筛选，版本和负责人可追踪。方案不包含数据库、窗体、查询、宏或自动导入连接。",
        "Deliver an editable XLSX plan with entities, field dictionary, relationship matrix, source-to-target mapping, sanitized samples and import acceptance sheets. Preserve identifiers as text and label versions and owners. The plan contains no database, forms, queries, macros or automated connection.",
      ],
      checks: [
        "核对字段类型与样例、主键唯一性、外键引用、必填和单位，设计正常、重复、缺失、长度超限和错误日期测试；核对导入前后记录数及例外数。只能描述拟实施验证，未创建或测试 Access 数据库时不得声称关系约束或权限已生效。",
        "Check field types against samples, primary-key uniqueness, foreign-key references, required values and units; design duplicate, missing, overlength and invalid-date cases and reconcile imported counts. These are proposed tests; do not claim Access constraints or permissions are active without an actual database test.",
      ],
    },
    context: {
      focus: [
        "明确实体粒度、主外键和后续导入的业务边界。",
        "Define entity grain, primary and foreign keys, and import scope.",
      ],
      inputs: [
        "保留来源列、字段类型、必填约束和数据责任人，注明源数据编码、重复键处理及导入前备份要求。",
        "Retain source columns, field types, required constraints and owners; document source encoding, duplicate-key handling and pre-import backups.",
      ],
      output: [
        "输出工作簿字段字典、关系映射、样例和验收规则。",
        "Produce workbook field dictionaries, relationship mappings, examples and acceptance rules.",
      ],
      risk: [
        "仅交付方案工作簿，不声称已生成或连接 Access 数据库。",
        "Deliver a planning workbook only; do not claim an Access database was created or connected.",
      ],
    },
    rows: [
      [
        ["客户主数据台账", "Customer master register"],
        ["设计客户主档与联系人一对多关系。", "Design a customer master with one-to-many contacts."],
        [
          "收集客户编号、名称、状态、联系人及来源列。",
          "Gather customer ID, name, status, contact and source columns.",
        ],
        [
          "输出客户键、联系人外键和去重规则。",
          "Show customer keys, contact foreign keys and deduplication rules.",
        ],
        [
          "同名客户不能自动合并，联系方式应最小化。",
          "Do not merge same-name customers automatically; minimize contact data.",
        ],
      ],
      [
        ["合同资料台账", "Contract register"],
        [
          "设计合同、相对方和合同版本关联。",
          "Design relationships among contracts, counterparties and versions.",
        ],
        [
          "收集合同编号、主体、签署日、期限及金额。",
          "Gather contract IDs, entities, signature dates, terms and amounts.",
        ],
        [
          "输出合同字段、版本映射和到期校验。",
          "Show contract fields, version mappings and expiry validation.",
        ],
        [
          "金额币种缺失和签署状态未经核实须隔离。",
          "Quarantine missing currencies and unverified execution status.",
        ],
      ],
      [
        ["资产管理台账", "Asset register"],
        [
          "设计资产、使用部门和领用记录关系。",
          "Design relationships between assets, departments and assignments.",
        ],
        [
          "收集资产编号、分类、购置日、使用状态及责任人。",
          "Gather asset IDs, categories, purchase dates, statuses and custodians.",
        ],
        [
          "输出资产字典、领用映射和重复校验。",
          "Show asset fields, assignment mappings and duplicate checks.",
        ],
        ["缺失资产编号不能仅按名称合并。", "Do not merge assets by name when IDs are absent."],
      ],
      [
        ["工单数据台账", "Service ticket register"],
        [
          "设计工单、处理事件及责任团队关系。",
          "Design tickets, handling events and responsible teams.",
        ],
        [
          "收集工单号、受理时间、类别、状态及处理人。",
          "Gather ticket IDs, intake times, categories, statuses and owners.",
        ],
        [
          "输出工单主键、事件外键及状态字典。",
          "Show ticket keys, event foreign keys and status dictionary.",
        ],
        ["多次转派不可覆盖原始处理历史。", "Do not overwrite handling history after reassignment."],
      ],
      [
        ["库存批次台账", "Inventory lot register"],
        [
          "设计物料、仓库和批次余额的组合粒度。",
          "Design a composite grain for items, warehouses and lot balances.",
        ],
        [
          "收集物料号、批号、库位、效期、单位和数量。",
          "Gather item and lot IDs, locations, expiry, units and quantities.",
        ],
        ["输出组合键、字段类型和单位检查。", "Show composite keys, field types and unit checks."],
        ["同批号不同物料不能误合并。", "Do not merge identical lot numbers from different items."],
      ],
      [
        ["供应商资料台账", "Supplier register"],
        [
          "设计供应商主档、资质和有效期记录。",
          "Design supplier master, qualifications and expiry records.",
        ],
        [
          "收集供应商编号、名称、证照类型、有效期和状态。",
          "Gather supplier IDs, names, credential types, expiry and status.",
        ],
        [
          "输出供应商与资质关系及导入规则。",
          "Show supplier-credential relationships and import rules.",
        ],
        ["资质缺失不可填成已通过。", "Do not mark missing qualifications as verified."],
      ],
      [
        ["培训记录台账", "Training attendance register"],
        [
          "设计课程、学员和参加记录的关联。",
          "Design relationships among courses, participants and attendance.",
        ],
        [
          "收集课程编号、员工编号、日期、完成状态及证据。",
          "Gather course and employee IDs, dates, completion status and evidence.",
        ],
        [
          "输出关联键、状态值和重复记录检查。",
          "Show relationship keys, status values and duplicate checks.",
        ],
        [
          "报名不代表完成，员工资料须限制传播。",
          "Enrollment does not mean completion; limit employee-data distribution.",
        ],
      ],
      [
        ["会议行动项台账", "Meeting action register"],
        [
          "设计会议与多个行动项之间的关系。",
          "Design one-to-many meeting and action-item relationships.",
        ],
        [
          "收集会议编号、行动编号、责任人、期限与状态。",
          "Gather meeting IDs, action IDs, owners, deadlines and statuses.",
        ],
        ["输出主外键、状态字典和导入映射。", "Show keys, status dictionary and import mappings."],
        ["无会议主记录的行动项应隔离待补。", "Quarantine actions without a parent meeting record."],
      ],
      [
        ["问题整改台账", "Issue remediation register"],
        [
          "设计问题、整改措施和验证记录的分层关系。",
          "Design linked issues, corrective actions and verification records.",
        ],
        [
          "收集问题编号、严重度、措施、责任人和验证日。",
          "Gather issue IDs, severity, actions, owners and verification dates.",
        ],
        ["输出多项整改映射及关闭规则。", "Show multiple-action mappings and closure rules."],
        [
          "措施完成不等于复验通过。",
          "An action marked complete does not establish successful verification.",
        ],
      ],
      [
        ["费用凭证台账", "Expense evidence register"],
        ["设计报销单与多张票据的关联结构。", "Design expense claims linked to multiple receipts."],
        [
          "收集单号、票据号码、日期、币种及金额字段。",
          "Gather claim IDs, receipt numbers, dates, currencies and amounts.",
        ],
        [
          "输出单据键、票据键及金额导入规则。",
          "Show claim and receipt keys and amount import rules.",
        ],
        [
          "票据号前导零和重复红冲须保留复核。",
          "Preserve leading zeros and review duplicate reversals.",
        ],
      ],
      [
        ["项目里程碑台账", "Project milestone register"],
        [
          "设计项目、里程碑及依赖关系。",
          "Design projects, milestones and dependency relationships.",
        ],
        [
          "收集项目号、节点号、计划日、实际日及依赖。",
          "Gather project and milestone IDs, planned and actual dates, and dependencies.",
        ],
        [
          "输出节点外键、依赖映射和日期约束。",
          "Show milestone foreign keys, dependencies and date rules.",
        ],
        [
          "循环依赖或缺失项目应列待处理。",
          "Flag circular dependencies and missing parent projects.",
        ],
      ],
      [
        ["访问授权台账", "Access authorization register"],
        [
          "设计人员、资源和授权记录的对应关系。",
          "Design mappings among people, resources and authorization records.",
        ],
        [
          "收集人员标识、资源编号、权限、批准与有效期。",
          "Gather person IDs, resource IDs, privileges, approval and validity.",
        ],
        [
          "输出授权字段、复核日期及失效规则。",
          "Show authorization fields, review dates and expiration rules.",
        ],
        [
          "台账不自动实施权限，实际撤权需另行确认。",
          "The register does not enforce access; confirm revocation separately.",
        ],
      ],
    ],
  }),
  officeFamily({
    id: "service-operations",
    name: ["服务运营管理", "Service operations"],
    category: "operations",
    format: "XLSX",
    summary: [
      "跟踪服务请求、时效、积压、质量与改进措施",
      "Track service requests, timeliness, backlog, quality and improvement actions",
    ],
    headings: [
      ["服务范围", "Service scope"],
      ["请求与分类", "Requests and categories"],
      ["时效与积压", "Timeliness and backlog"],
      ["质量与反馈", "Quality and feedback"],
      ["升级与整改", "Escalation and remediation"],
      ["复核与行动", "Review and action"],
    ],
    audience: [
      "服务运营、客服主管和一线处理人员",
      "Service operations, support supervisors and frontline staff",
    ],
    playbook: {
      inputs: [
        "收集工单编号、渠道、客户类别、受理与响应时间、优先级、服务协议、分派、处理、解决、重开及回访记录，注明服务时段、时区和数据截止日。个人信息按用途最小化并指定数据责任人，缺少事件时间或服务约定时保留未知。",
        "Gather ticket IDs, channels, customer categories, intake and response times, priorities, service agreements, assignments, resolutions, reopenings and follow-ups. State service hours, time zone, cutoff and data owner; minimize personal data and leave missing timestamps or agreements unknown.",
      ],
      method: [
        "按工单和事件时间线定义首响、解决、等待和暂停时长，说明工作时间、节假日、优先级与分母，区分开放积压、逾期及已解决。投诉、重复联系和回访要保留关联键；按证据区分响应延迟、需求变化和外部依赖。",
        "Define first response, resolution, waiting and paused time on a ticket timeline, including working hours, holidays, priority and denominators; separate open backlog, overdue and resolved cases. Link complaints, repeat contacts and follow-ups, distinguishing delay causes from evidence.",
      ],
      design: [
        "设置工单明细、事件记录、服务时效规则、积压统计、质检回访和行动追踪工作表；编号保留文本，日期时间列另配时区或偏移列，核对夏令时和跨日，不假称已换算。冻结表头，按团队、优先级及状态筛选，敏感客户资料不写入不必要的共享副本。",
        "Separate tickets, events, service rules, backlog, quality checks and actions. Keep IDs as text and timestamps in typed cells with separate time-zone or offset columns; check daylight-saving and date boundaries without claiming conversion. Freeze and filter headers, and omit unnecessary sensitive customer data from shared copies.",
      ],
      checks: [
        "核对工单数、各状态合计及事件时间先后，抽查重复单、重开、跨工作时段、转派和暂停规则；检查分母为零及抽检样本局限。复核关键公式与实际重算状态，没有系统数据或反馈原文时不能声称服务达标或客户满意。",
        "Reconcile ticket counts and statuses and inspect timestamp order, duplicates, reopenings, working hours, transfers and pauses. Check zero denominators and sample limits, review formulas and disclose recalculation status; missing system data or feedback cannot prove service compliance or satisfaction.",
      ],
    },
    context: {
      focus: [
        "明确工单范围、统计时段、服务等级及处理责任。",
        "Define ticket scope, reporting period, service level and ownership.",
      ],
      inputs: [
        "保留工单编号、事件时间、状态、渠道及证据来源，记录各状态口径变化、处理时区和服务日历。",
        "Retain ticket IDs, event times, status, channel and evidence source, including status-definition changes, time zone and service calendar.",
      ],
      output: [
        "列出计算口径、待办责任、异常原因及复核时间。",
        "Show calculation definitions, action owners, exception causes and review dates.",
      ],
      risk: [
        "缺少系统记录或客户确认时不得宣称问题解决或服务达标。",
        "Do not claim resolution or compliance without system records or customer confirmation.",
      ],
    },
    rows: [
      [
        ["工单分流安排", "Ticket triage"],
        [
          "按类别、紧急度和技能将请求分派给团队。",
          "Route requests by category, urgency and team capability.",
        ],
        [
          "收集请求类别、优先级、技能组及可用人员。",
          "Gather request categories, priorities, skill groups and available staff.",
        ],
        [
          "输出分流队列、责任人和待澄清项目。",
          "Show routing queue, owners and requests needing clarification.",
        ],
        [
          "敏感事件和高优先级须按授权路径升级。",
          "Escalate sensitive and high-priority cases through authorized paths.",
        ],
      ],
      [
        ["首次响应时效", "First-response time"],
        [
          "计算受理到首次有效响应的服务时间。",
          "Measure service time from intake to first meaningful response.",
        ],
        [
          "收集受理、响应时间、服务时段及等级。",
          "Gather intake and response times, service hours and priority.",
        ],
        [
          "输出首响分布、超时单和分母。",
          "Show response-time distribution, breaches and denominators.",
        ],
        [
          "自动确认是否计作首响须按服务约定判断。",
          "Use service terms to determine whether automated acknowledgments count.",
        ],
      ],
      [
        ["解决时长分析", "Resolution time analysis"],
        [
          "比较各等级工单的受理至解决时长。",
          "Compare intake-to-resolution times across priorities.",
        ],
        [
          "收集受理、暂停、恢复、解决与重开时间。",
          "Gather intake, pause, resume, resolution and reopening times.",
        ],
        ["输出分位数、超时原因及样本量。", "Show percentiles, breach reasons and sample sizes."],
        [
          "重复重开与等待客户的计时规则必须说明。",
          "Explain timing rules for reopenings and customer waits.",
        ],
      ],
      [
        ["积压清理计划", "Backlog reduction"],
        [
          "按账龄、影响和处理依赖排序未结工单。",
          "Prioritize open tickets by age, impact and dependencies.",
        ],
        [
          "收集未结状态、创建日、责任人及下一动作。",
          "Gather open statuses, creation dates, owners and next actions.",
        ],
        [
          "输出分层积压、清理批次和复查时间。",
          "Show aged backlog, clearance batches and review dates.",
        ],
        [
          "不能为降低积压而无依据关闭工单。",
          "Do not close tickets without evidence merely to reduce backlog.",
        ],
      ],
      [
        ["投诉升级跟踪", "Complaint escalation"],
        [
          "跟踪投诉严重度、升级和答复承诺。",
          "Track complaint severity, escalation and response commitments.",
        ],
        [
          "收集投诉编号、影响、证据、责任和承诺日期。",
          "Gather complaint IDs, impacts, evidence, owners and promised dates.",
        ],
        [
          "输出升级记录、处理意见和未决责任。",
          "Show escalation history, dispositions and outstanding ownership.",
        ],
        [
          "未经核实的指控与已确认事实需分开。",
          "Separate unverified allegations from established facts.",
        ],
      ],
      [
        ["服务排班覆盖", "Service staffing coverage"],
        [
          "比较时段来单需求与班次可用人数。",
          "Compare incoming demand with available staff by shift.",
        ],
        [
          "收集历史来单量、班次、技能、休假及服务时间。",
          "Gather historical volumes, shifts, skills, leave and service hours.",
        ],
        ["输出覆盖缺口、备援和调整建议。", "Show coverage gaps, backups and scheduling proposals."],
        [
          "休假或未培训人员不得按完整产能计入。",
          "Do not count absent or untrained staff as full capacity.",
        ],
      ],
      [
        ["知识库缺口分析", "Knowledge-base gaps"],
        [
          "识别重复问题与缺失或过期知识条目。",
          "Identify recurring questions and missing or outdated articles.",
        ],
        [
          "收集工单分类、搜索词、知识编号和使用反馈。",
          "Gather ticket categories, search terms, article IDs and feedback.",
        ],
        ["输出候选条目、责任人及复审期限。", "Show candidate articles, owners and review dates."],
        [
          "缺少原始证据时不能杜撰解决步骤。",
          "Do not invent resolution steps without source evidence.",
        ],
      ],
      [
        ["服务质量抽检", "Service quality sampling"],
        [
          "依据评分标准抽查工单处理质量。",
          "Sample ticket handling against agreed quality criteria.",
        ],
        [
          "收集抽样范围、样本、评分表及检查证据。",
          "Gather sampling frame, samples, scorecard and evidence.",
        ],
        ["输出评分、缺陷和改进建议。", "Show scores, defects and improvement actions."],
        [
          "非随机或小样本结果不可代表全部服务。",
          "Nonrandom or small samples do not represent all service.",
        ],
      ],
      [
        ["重复联系追踪", "Repeat contact tracking"],
        ["关联同一问题的多次来电或工单。", "Link repeated calls or tickets about the same issue."],
        [
          "收集关联编号、时间窗口、问题类型及解决状态。",
          "Gather linked IDs, time windows, issue types and resolution status.",
        ],
        [
          "输出重复联系率、关联依据和主要原因。",
          "Show repeat-contact rate, linkage evidence and causes.",
        ],
        [
          "同一客户不同问题不能自动合并。",
          "Do not automatically merge different issues from one customer.",
        ],
      ],
      [
        ["升级超时跟进", "Escalation deadline tracking"],
        [
          "监控转派或升级后的接手和处置期限。",
          "Monitor acceptance and handling deadlines after escalation.",
        ],
        [
          "收集升级时间、接收团队、时限及确认记录。",
          "Gather escalation times, receiving teams, deadlines and acknowledgments.",
        ],
        ["输出未接手、超时和责任链。", "Show unaccepted cases, breaches and ownership chains."],
        [
          "缺少接收确认不得视为已交接完成。",
          "Do not treat escalation as handed over without acknowledgment.",
        ],
      ],
      [
        ["客户回访记录", "Customer follow-up"],
        [
          "记录解决后回访、反馈和再次联系需求。",
          "Record post-resolution follow-up, feedback and further needs.",
        ],
        [
          "收集关联工单、回访时间、结果及客户原话。",
          "Gather linked tickets, follow-up dates, results and customer statements.",
        ],
        [
          "输出已回访、未联系和待处理反馈。",
          "Show completed, unreachable and actionable feedback.",
        ],
        [
          "无回复不等于满意，不得虚构客户评价。",
          "No response does not imply satisfaction; do not invent feedback.",
        ],
      ],
      [
        ["服务月度运营汇总", "Monthly service operations summary"],
        [
          "汇总来单、解决、积压、时效与重点问题。",
          "Summarize volume, resolution, backlog, timeliness and key issues.",
        ],
        [
          "收集统计期间、工单事件、目标及上月快照。",
          "Gather reporting period, ticket events, targets and previous snapshot.",
        ],
        [
          "输出指标口径、变化原因及行动负责人。",
          "Show metric definitions, changes and action owners.",
        ],
        [
          "未结束工单不可计入已解决分母。",
          "Do not include unresolved tickets in resolved-case denominators.",
        ],
      ],
    ],
  }),
];
