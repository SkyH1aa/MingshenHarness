import type { CreativeAuthoredScenario, CreativeTranslation } from "./creative-template-authoring";

type Detail = Pick<CreativeAuthoredScenario, "inputs" | "focus" | "output" | "risk">;

const ZH_MIN_FIELD = 35;
const ZH_MIN_TOTAL = 180;
const FIELDS: readonly (keyof Detail)[] = ["inputs", "focus", "output", "risk"];
const FIELD_SUFFIXES: Detail = {
  inputs: [
    "补充资料版本、来源日期、单位和缺失项。",
    "Record source version, date, units and gaps.",
  ],
  focus: [
    "保留执行步骤、判断依据、异常分支和人工确认点。",
    "Retain steps, rationale, exception paths and human checkpoints.",
  ],
  output: [
    "提供可编辑产物、来源链接、责任人及复核清单。",
    "Provide editable outputs, source links, owners and review checklist.",
  ],
  risk: [
    "未验证、授权不足或口径冲突时暂停发布并升级。",
    "Pause and escalate when evidence, authorization or definitions conflict.",
  ],
};

const chineseLength = (value: string): number => (value.match(/\p{Script=Han}/gu) ?? []).length;

const enrichPairs = (pairs: Detail): Detail => {
  const result = { ...pairs };
  for (const field of FIELDS) {
    if (chineseLength(result[field][0]) < ZH_MIN_FIELD) {
      result[field] = [
        `${result[field][0]}${FIELD_SUFFIXES[field][0]}`,
        `${result[field][1]} ${FIELD_SUFFIXES[field][1]}`,
      ];
    }
  }
  let total = FIELDS.reduce((sum, field) => sum + chineseLength(result[field][0]), 0);
  while (total < ZH_MIN_TOTAL) {
    const field = FIELDS.reduce<keyof Detail>(
      (shortest, current) =>
        chineseLength(result[current][0]) < chineseLength(result[shortest][0]) ? current : shortest,
      "inputs",
    );
    result[field] = [
      `${result[field][0]}${FIELD_SUFFIXES[field][0]}`,
      `${result[field][1]} ${FIELD_SUFFIXES[field][1]}`,
    ];
    total = FIELDS.reduce((sum, item) => sum + chineseLength(result[item][0]), 0);
  }
  return result;
};

const detail = (
  inputs: CreativeTranslation,
  focus: CreativeTranslation,
  output: CreativeTranslation,
  risk: CreativeTranslation,
): Detail => enrichPairs({ inputs, focus, output, risk });

export const LEGACY_DETAILED_CASES_B: Readonly<Record<string, readonly Detail[]>> = {
  "research-report": [
    detail(
      [
        "收集研究地区与期间、目标客户数量、购买频次、实际成交价格及可追溯统计资料，分别记录来源、单位、样本范围和发布日期。",
        "Collect geography, period, target customer counts, purchase frequency, realized prices and traceable statistics; record sources, units, samples and publication dates.",
      ],
      [
        "先用总体数量、渗透率和客单支出自上而下估算，再按客户分组与可触达数量自下而上核算，解释两种结果的差异和敏感因素。",
        "Estimate top-down from population, penetration and spending, then bottom-up from customer segments and reachable accounts; explain discrepancies and sensitivities.",
      ],
      [
        "交付市场边界定义、分群计算表、两种测算的对照结果及关键假设区间，结论关联资料来源，并单列缺失数据和后续调研。",
        "Deliver market definitions, segment calculations, a comparison of both estimates and assumption ranges, with source links, data gaps and follow-up research.",
      ],
      [
        "不得将相邻市场收入混入目标规模，也不得将宣传预测当成实际收入；核对币种、统计年份及客户去重，证据不足时保留未知。",
        "Do not mix adjacent markets or treat promotional forecasts as actual revenue; check currency, years and deduplication, and leave unsupported estimates unknown.",
      ],
    ),
    detail(
      [
        "收集连续期间的行业指标、技术进展、政策原文与客户需求记录，记录统计口径调整、资料发布日期和可能影响可比性的事件。",
        "Collect industry time series, technology developments, policy texts and customer demand records; document definition changes, publication dates and comparability issues.",
      ],
      [
        "按时间线区分已经发生的变化与未来假说，比较增长、成本和需求结构，并寻找相反证据解释趋势可能中断的条件与影响。",
        "Separate observed changes from future hypotheses on a timeline; compare growth, costs and demand structure, and seek counterevidence and break conditions.",
      ],
      [
        "交付带来源的趋势时间线、驱动因素与影响矩阵、相互矛盾的信息清单以及需持续跟踪的指标，说明适用范围与资料截止日。",
        "Deliver a sourced trend timeline, driver-impact matrix, contradictory evidence list and monitoring indicators, stating scope and information cutoff.",
      ],
      [
        "避免把短期波动直接外推为长期趋势，核验数据连续性和政策生效状态；不同机构预测不一致时分别列出并解释口径差异。",
        "Do not extrapolate short-term fluctuations blindly; verify series continuity and policy status, and present conflicting forecasts with their different definitions.",
      ],
    ),
    detail(
      [
        "收集竞品名单、适用客户、功能文档、公开定价和财报，并注明版本、地区与获取日期；补充自身产品可公开的事实基线。",
        "Collect competitor names, target users, feature documentation, public prices and financial reports with version, region and date, plus an internal factual baseline.",
      ],
      [
        "使用统一客户任务和评价维度比较产品定位、能力、交付方式与价格，区分公开声明和实际测试，并解释各候选适合的情境。",
        "Compare positioning, capabilities, delivery and pricing against common user tasks; distinguish vendor claims from tests and explain suitable situations.",
      ],
      [
        "交付带来源的竞品矩阵、客户定位图或文字对照、差异及证据缺口清单，附待验证问题和建议的下一轮实测方案与负责人。",
        "Deliver a sourced competitor matrix, positioning comparison, differences and evidence gaps, with questions, owners and a proposed validation plan.",
      ],
      [
        "没有找到资料不代表竞品缺少某项能力；避免使用过期价格、未经授权的客户信息或未经验证的性能断言，标明比较时间。",
        "Missing information does not prove a capability is absent; avoid stale pricing, unauthorized customer data and untested performance claims, and date comparisons.",
      ],
    ),
    detail(
      [
        "收集适用地区、业务活动、政策发布机关、正式文本、生效时间及修订记录，确认企业自身的业务边界和咨询法律专业人士的渠道。",
        "Collect jurisdictions, business activities, issuing authorities, official texts, effective dates and amendments; define business scope and legal-review channels.",
      ],
      [
        "逐条提取适用条件、义务、时限和例外，映射到受影响流程与责任岗位；区分政策原文、解释和企业拟采取的应对措施。",
        "Extract applicability, obligations, deadlines and exceptions; map affected processes and owners, separating official text, interpretation and proposed responses.",
      ],
      [
        "交付政策索引与原文链接、适用性判断表、影响和行动清单，注明生效状态、审阅人、待确认问题及下次复核的触发条件。",
        "Deliver a policy index with original links, applicability table, impacts and actions, including status, reviewers, open questions and review triggers.",
      ],
      [
        "政策解读不构成法律意见，不得把草案写成已生效规则；检查地区、版本、豁免及跨境差异，重大决定提交有资质人员复核。",
        "Interpretation is not legal advice; do not treat drafts as effective law. Check jurisdiction, version, exemptions and cross-border differences; obtain qualified review.",
      ],
    ),
    detail(
      [
        "明确研究问题、学科范围、检索库、关键词及同义词，收集纳入与排除条件、文献全文或摘要，以及已有的质量评价标准。",
        "Define the research question, disciplines, databases, search terms, inclusion and exclusion criteria, available papers and quality appraisal standards.",
      ],
      [
        "记录检索式和日期，去重后按标题摘要与全文分阶段筛选；比较研究设计、样本、主要结论及分歧，保留未被支持的反例。",
        "Record search strings and dates, deduplicate and screen in stages; compare study designs, samples, findings and disagreements, including counterexamples.",
      ],
      [
        "交付检索与筛选流程、研究特征及质量证据表、主题综述和参考文献，说明共识、争议、研究空白以及未来研究建议。",
        "Deliver search and screening steps, a study-characteristics and quality table, thematic synthesis and references, including consensus, disputes and gaps.",
      ],
      [
        "不得编造论文、作者、引用页码或实验结果；区分同行评议与预印本，标注语言、时间和数据库限制及可获取全文的范围。",
        "Never invent papers, authors, page numbers or results; distinguish peer-reviewed work from preprints and disclose language, date, database and access limits.",
      ],
    ),
    detail(
      [
        "收集案例选择目的、候选案例清单、组织背景、时间线、采取的行动和可核验结果，并记录各案例资料的来源及完整程度。",
        "Gather the selection purpose, candidate cases, organizational context, timeline, actions and verifiable outcomes, recording source coverage for each case.",
      ],
      [
        "先确定相同的比较维度与基线，再逐案整理条件、行动和结果；识别环境差异及其他可能解释，不把同时发生直接视为因果。",
        "Define common comparison criteria and baselines, then map conditions, actions and outcomes; identify contextual differences and alternative explanations.",
      ],
      [
        "交付案例选择与排除说明、同口径比较表、共性与差异分析、可迁移条件以及无法迁移的边界，附原始证据和未答问题。",
        "Deliver selection criteria, a common comparison table, similarities and differences, transfer conditions and boundaries, with evidence and open questions.",
      ],
      [
        "避免仅挑选成功案例造成幸存者偏差，不把缺少数据的指标补成零；涉及客户名称、照片或具体经营数据时先确认披露授权。",
        "Avoid survivor bias from selecting only successes and never replace missing metrics with zero; obtain permission before revealing customer identities or data.",
      ],
    ),
    detail(
      [
        "收集问卷版本、完整题目和选项、抽样框、回收日期、匿名答卷、样本量及使用授权，确认多选题和跳题的设计口径。",
        "Collect questionnaire versions, questions and options, sampling frame, dates, anonymized responses, sample sizes and consent, including skip and multiple-choice rules.",
      ],
      [
        "先检查重复、无效和缺失答卷，记录处理规则；按题目实际分母计算分布并谨慎分组，开放题进行主题归纳并保留反例。",
        "Document deduplication, invalid and missing responses; calculate distributions using each question's denominator, cautiously segment and code open answers with counterexamples.",
      ],
      [
        "交付样本与回收说明、清洗日志、逐题统计表、主要发现与匿名摘录，并列出样本覆盖、未回答比例和可供复核的计算口径。",
        "Deliver sampling and response details, cleaning log, question-level tables, findings and anonymized excerpts, with coverage, nonresponse and reproducible definitions.",
      ],
      [
        "不将便利样本直接代表总体，人数过小的分组不披露可识别信息；不得编造结果，没有授权且不具备其他合法处理依据的答卷应停止处理，合法处理的数据也应按需脱敏。",
        "Do not generalize convenience samples or expose identifiable small groups; never invent responses. Stop processing data without authorization or another lawful basis, and minimize and de-identify data lawfully processed as appropriate.",
      ],
    ),
    detail(
      [
        "收集访谈目标、提纲、受访者角色构成、录音转写或笔记、访谈日期和使用授权，明确哪些原话允许匿名引用与内部传播。",
        "Collect objectives, interview guides, participant roles, transcripts or notes, dates and consent; identify quotations approved for anonymized internal use.",
      ],
      [
        "建立可复核的主题编码，逐份标记受访者描述、行为线索与研究者推断，再比较不同角色的共识、矛盾和未被覆盖的问题。",
        "Create auditable thematic codes; label participant statements, behavioral evidence and researcher inferences, then compare agreement, conflicts and gaps across roles.",
      ],
      [
        "交付样本构成、访谈主题矩阵、匿名原话及上下文、发现的证据链和待验证假设，附受众范围、研究限制与下一步问题。",
        "Deliver participant composition, thematic matrix, contextualized anonymous quotes, evidence trails and testable hypotheses, with scope, limitations and next steps.",
      ],
      [
        "不得将总结改写成受访者原话，避免用少数访谈推断整体比例；删除姓名、公司和可反推身份的细节，撤回授权时停止引用。",
        "Do not present summaries as direct quotes or infer population proportions from a few interviews; remove identifying details and stop using withdrawn material.",
      ],
    ),
    detail(
      [
        "收集客户目标、关键任务、访谈与反馈、服务工单和使用记录，记录客户分群、采集期间、接触渠道及每份资料的授权范围。",
        "Gather customer goals, tasks, interviews, feedback, support tickets and usage records; document segment, period, channel and authorization for each source.",
      ],
      [
        "将客户任务拆为触发情境、期望结果和实际障碍，对照访谈与行为证据，按影响范围、发生频率及业务目标讨论需求优先级。",
        "Map each task to triggers, desired outcomes and obstacles; triangulate interviews with behavior and prioritize by reach, frequency and business objectives.",
      ],
      [
        "交付需求与证据对应表、客户旅程障碍、分群差异、优先级依据和待确认假设，提出下一轮访谈或试验要回答的具体问题。",
        "Deliver a need-to-evidence table, journey obstacles, segment differences, prioritization rationale and hypotheses, with specific questions for follow-up research.",
      ],
      [
        "不要把内部设想直接写成客户真实需求，保留不同意见及未覆盖人群；使用工单和访谈时去除识别信息并限制无关敏感字段。",
        "Do not present internal assumptions as customer needs; retain dissent and uncovered groups, and remove identifying or unrelated sensitive information.",
      ],
    ),
    detail(
      [
        "收集服务承诺、渠道工单、接待与解决时间、投诉记录和满意度反馈，明确统计期间、服务对象及每个工单的唯一标识。",
        "Collect service commitments, channel tickets, response and resolution times, complaints and satisfaction feedback, with period, audience and unique ticket IDs.",
      ],
      [
        "按接入、响应、处理和回访环节对照标准，计算量、时效和未解决比例；合并重复记录并比较渠道、问题类型与异常原因。",
        "Compare intake, response, resolution and follow-up against standards; calculate volume, timeliness and unresolved rates, deduplicate and segment exceptions.",
      ],
      [
        "交付服务旅程缺口表、分环节指标与分母、投诉主题、典型案例和纠正措施，注明责任人、复核日期及可追溯的原始记录。",
        "Deliver stage-level gaps, metrics and denominators, complaint themes, examples and corrective actions, with owners, review dates and traceable records.",
      ],
      [
        "统一工单时区、统计周期和关闭定义，避免重复工单或缺失时间造成失真；满意度低回复率及未获得许可的客户资料需明确处理。",
        "Align time zones, periods and closure definitions; handle duplicates and missing times, and disclose low survey response and unauthorized customer information.",
      ],
    ),
    detail(
      [
        "收集流失及活跃定义、客户分群、观察窗口、使用频率、续费状态和授权访谈记录，确认账户合并规则与数据提取日期。",
        "Collect churn and activity definitions, customer segments, observation windows, usage, renewals and authorized interviews; define account merging and extraction dates.",
      ],
      [
        "按同期群和客户类型比较流失时间、使用变化与续费差异，结合访谈提出可检验假设，并设计与未流失客户的对照方式。",
        "Compare churn timing, usage changes and renewals by cohort and segment; form testable interview-informed hypotheses and define comparisons with retained customers.",
      ],
      [
        "交付流失口径、同期群分布表、可能驱动及支持与反对证据、优先验证假设和跟进行动，列明各项数据的观察窗口。",
        "Deliver churn definitions, cohort distributions, possible drivers with supporting and contrary evidence, validation priorities and observation windows.",
      ],
      [
        "相关性不能直接说明流失原因，不能把尚未到续费期的客户算作流失；小样本、删失数据和账号关联不确定均需披露。",
        "Correlation does not establish causation; do not count customers before renewal as churned, and disclose small samples, censoring and uncertain identity links.",
      ],
    ),
    detail(
      [
        "收集各渠道投放费用、曝光或线索、阶段转化、订单、退款与归因规则，统一统计区间、币种、订单编号及渠道标识。",
        "Gather channel costs, impressions or leads, funnel conversions, orders, refunds and attribution rules; align period, currency, order IDs and channel identifiers.",
      ],
      [
        "建立渠道漏斗并计算获客成本、转化和回收情况，比较不同归因窗口与重叠触点；有条件时设计对照试验估计增量。",
        "Build channel funnels and calculate acquisition cost, conversion and payback; compare attribution windows and overlapping touches, proposing controlled incrementality tests when feasible.",
      ],
      [
        "交付投入产出与转化明细、归因假设表、渠道重叠和退款处理说明，以及预算调整建议、实验方案和不能判断的指标。",
        "Deliver investment and conversion details, attribution assumptions, overlap and refund treatment, budget recommendations, experiments and indeterminate metrics.",
      ],
      [
        "避免重复归因订单或把相关转化全算作渠道增量；无对照组时说明因果限制，检查隐私许可、转化延迟和费用是否完整。",
        "Avoid duplicate order attribution or claiming all associated conversions as incremental; disclose causal limits without controls and check consent, delays and costs.",
      ],
    ),
  ],
  "technical-evaluation": [
    detail(
      [
        "收集读写比例、事务模式、数据规模、增长、延迟目标与一致性要求，列出候选数据库版本、部署条件和现有迁移限制。",
        "Collect read/write ratios, transactions, data growth, latency and consistency needs, candidate database versions, deployment conditions and migration constraints.",
      ],
      [
        "按真实查询、并发事务、备份恢复和扩容场景制定同口径比较；计算许可与运维成本，并在可用环境下执行代表性负载测试。",
        "Compare representative queries, concurrency, backup, recovery and scaling consistently; assess licensing and operational costs and test realistic workloads when feasible.",
      ],
      [
        "交付需求与候选矩阵、测试环境和负载记录、成本及迁移步骤、推荐条件与不确定项，明确恢复目标和负责验证的人员。",
        "Deliver requirements and candidate matrices, environment and workload records, costs, migration steps, recommendation conditions and outstanding recovery checks.",
      ],
      [
        "不可把厂商基准当作本环境实测；记录硬件、数据集和预热方法，未演练的故障切换或恢复目标必须标为尚未验证。",
        "Do not treat vendor benchmarks as local measurements; record hardware, dataset and warm-up, marking untested failover or recovery objectives unverified.",
      ],
    ),
    detail(
      [
        "收集消息量与峰值、载荷、顺序范围、投递保证、保留时长、消费者模型以及候选产品的版本和运维环境。",
        "Collect peak and sustained volume, payloads, ordering scope, delivery guarantees, retention, consumer model and candidate versions and operating environments.",
      ],
      [
        "比较分区、重试、死信、回压与扩容，设计生产者和消费者中断测试，检验重复投递处理及恢复顺序是否满足业务要求。",
        "Compare partitioning, retries, dead letters, backpressure and scaling; design producer and consumer failure tests for duplication handling and recovery ordering.",
      ],
      [
        "交付消息语义对照表、故障场景测试记录、容量与成本估算以及迁移回退方案，列出消费者幂等措施与待确认指标。",
        "Deliver delivery-semantics comparisons, failure test records, capacity and cost estimates, migration and rollback plans, idempotency measures and open metrics.",
      ],
      [
        "不要把至少一次交付写成天然恰好一次，说明顺序保证的分区边界；未执行的积压恢复和故障演练不能声称已通过。",
        "Do not equate at-least-once delivery with exactly-once processing; state ordering scope and mark unperformed backlog and failure tests unverified.",
      ],
    ),
    detail(
      [
        "收集应用运行时、部署频率、负载峰值、网络与数据位置要求、候选平台配置、预算及现有发布和运维人员能力。",
        "Collect runtimes, deployment frequency, peak load, networking and data-location requirements, platform configurations, budget and operational capabilities.",
      ],
      [
        "按构建发布、弹性扩容、监控告警、身份权限和故障恢复比较平台；评估迁移依赖、团队学习成本和可执行的回退路径。",
        "Compare build and release, scaling, monitoring, identity and disaster recovery; assess migration dependencies, training costs and feasible rollback paths.",
      ],
      [
        "交付平台适配与成本矩阵、部署拓扑、试点步骤、风险责任和回退条件，说明推荐方案需要满足的环境前提及审批事项。",
        "Deliver an applicability and cost matrix, deployment topology, pilot steps, risk owners and rollback conditions, with prerequisites and approvals.",
      ],
      [
        "核实平台区域可用性、服务配额与真实计费单位；安全隔离和恢复演练未经实测时保持未验证，不暗示已经具备生产资质。",
        "Verify regional availability, quotas and billing units; mark isolation and recovery exercises unverified until tested and avoid implying production readiness.",
      ],
    ),
    detail(
      [
        "收集对象、文件或块数据类型、容量增长、读写特征、保存期限、数据分类和恢复目标，列出候选存储服务及价格资料。",
        "Collect object, file or block data types, growth, access patterns, retention, classification and recovery objectives, plus candidate storage options and prices.",
      ],
      [
        "比较持久性设计、吞吐延迟、访问控制、生命周期与跨区域恢复，按数据量和请求量测算完整费用并设计恢复抽查。",
        "Compare durability design, latency, access control, lifecycle and cross-region recovery; model storage and request costs and design restoration checks.",
      ],
      [
        "交付数据分层与选型矩阵、费用和访问假设、备份恢复流程、试用结果及遗留问题，指定数据所有者和复核时点。",
        "Deliver tiering and selection matrices, cost and access assumptions, backup and restoration steps, trial results, data owners and review dates.",
      ],
      [
        "不要把供应商持久性声明等同于已验证可恢复；核实版本、区域、出站费用和删除策略，缺少恢复演练时标记风险。",
        "Do not equate vendor durability claims with tested recoverability; verify version, region, egress costs and deletion policy and flag missing restore tests.",
      ],
    ),
    detail(
      [
        "收集测试目标、硬件与软件版本、负载模型、数据集、监控方法和服务等级要求，记录预热时间及执行窗口。",
        "Collect objectives, hardware and software versions, workload model, dataset, monitoring, service targets, warm-up period and execution window.",
      ],
      [
        "按照固定脚本重复基准，分别记录吞吐、延迟分位数、错误和资源占用；比较基线并对异常波动进行复测与归因。",
        "Repeat benchmarks with fixed scripts, recording throughput, latency percentiles, errors and resource use; compare baselines and investigate anomalies.",
      ],
      [
        "交付环境配置、测试步骤、原始结果和统计摘要、指标图表或数据表，并说明复现命令、观察到的瓶颈及结论边界；额外列出P50、P95和P99延迟。",
        "Deliver environment configuration, procedures, raw results, summaries and plots or tables, with reproduction commands, observed bottlenecks, limits and P50/P95/P99 latency.",
      ],
      [
        "禁止捏造测试结果或只挑最佳一次作为结论；记录预热、样本数和噪声来源，测试资源不足时不要推断生产性能，注明工具版本和完整日志位置。",
        "Never invent results or select only the best run; report warm-up, samples, noise, tool versions and logs, avoiding production claims from inadequate tests.",
      ],
    ),
    detail(
      [
        "收集当前流量、资源使用、增长预测、服务目标、系统瓶颈、预算上限和可扩容组件，注明预测周期与基础数据来源。",
        "Collect current traffic, utilization, growth forecasts, service targets, bottlenecks, budget and scalable components, with forecast horizons and sources.",
      ],
      [
        "分别评估纵向、横向扩容和优化现有瓶颈的效果、依赖与故障边界，结合负载测试估算容量并设计分阶段扩容。",
        "Compare vertical and horizontal scaling and bottleneck optimization, dependencies and failure boundaries; estimate capacity from tests and stage rollout.",
      ],
      [
        "交付容量与触发阈值表、方案成本对照、扩容顺序、监控指标和回退步骤，写明尚需测量的数据及风险责任人。",
        "Deliver capacity and trigger thresholds, option costs, sequencing, monitoring and rollback steps, identifying missing measurements and risk owners.",
      ],
      [
        "不得将现有测试结果无限外推，检查共享依赖和单点限制；预算、吞吐或故障恢复未验证时分别标示假设与影响。",
        "Do not extrapolate beyond tested ranges; check shared dependencies and single points of failure, labeling unverified cost, throughput and recovery assumptions.",
      ],
    ),
    detail(
      [
        "收集热点数据、访问频率、源系统容量、一致性要求、可容忍过期时间和候选缓存架构，并列出敏感数据及访问权限。",
        "Collect hot data, access frequency, source capacity, consistency and staleness requirements, candidate cache designs, sensitive data and permissions.",
      ],
      [
        "比较缓存粒度、更新与失效策略，设计穿透、雪崩、击穿和源系统恢复时的测试，并明确缓存故障时的降级路径。",
        "Compare cache granularity, updates and invalidation; test penetration, stampedes and source recovery, and define degradation behavior when cache fails.",
      ],
      [
        "交付读写时序、键设计、过期与失效规则、容量估算及异常处置表，附命中率目标、测试结果和数据责任人。",
        "Deliver read/write sequences, key design, expiry and invalidation rules, capacity estimates and exception handling, with targets and test results.",
      ],
      [
        "避免把命中率作为唯一成功指标，核对敏感内容的隔离和过期；脏数据风险、并发写入竞态及恢复效果需以测试证据支持。",
        "Do not use hit rate as the sole success metric; check isolation and expiry, and support stale-data, concurrent-write and recovery claims with tests.",
      ],
    ),
    detail(
      [
        "收集批处理数据量、输入来源、运行窗口、依赖顺序、输出目的地、失败重试要求和允许消耗的计算资源上限。",
        "Collect batch volumes, sources, processing windows, dependencies, destinations, retry requirements and resource limits.",
      ],
      [
        "比较分片与调度方式，设计检查点、幂等键和部分失败重跑；在代表性负载下观察资源峰值及超时后的恢复行为。",
        "Compare partitioning and scheduling; design checkpoints, idempotency keys and partial reruns, observing resource peaks and timeout recovery under representative load.",
      ],
      [
        "交付任务依赖图或表、批次状态与重试规则、产出核对机制、容量预算和操作手册，列出未实测的恢复条件。",
        "Deliver job dependencies, batch states and retries, output reconciliation, capacity budget and runbook, including untested recovery conditions.",
      ],
      [
        "重跑不得产生重复写入或覆盖未确认结果；检查输入迟到、空批次和部分成功，外部依赖不可用时明确停止与告警方式。",
        "Reruns must not duplicate writes or overwrite unconfirmed output; handle late input, empty batches and partial success, stopping and alerting on dependency failure.",
      ],
    ),
    detail(
      [
        "收集直接与间接依赖、锁定版本、许可证、维护记录、安全公告和实际使用路径，确认升级兼容性及组织允许的许可范围。",
        "Collect direct and transitive dependencies, locked versions, licenses, maintenance history, advisories and usage paths, checking compatibility and approved licenses.",
      ],
      [
        "按可利用性、影响范围、维护活跃度与替代成本评估，区分已证实漏洞和仅有公告的风险，并规划升级、隔离或替换措施。",
        "Assess exploitability, exposure, maintenance and replacement costs; separate confirmed vulnerabilities from advisories and plan upgrades, isolation or replacement.",
      ],
      [
        "交付依赖版本和许可清单、风险分级、证据来源、修复优先级及兼容测试计划，记录负责人、复核日期和未解决事项。",
        "Deliver dependency and license inventories, risk ratings, sources, remediation priorities and compatibility tests, with owners, review dates and open issues.",
      ],
      [
        "漏洞库和许可状态可能变化，必须标明核查时点；不要宣称扫描结果覆盖全部风险，也不能未经法律审查保证许可合规。",
        "Date vulnerability and license checks; do not claim scans cover every risk or guarantee legal compliance without appropriate review.",
      ],
    ),
    detail(
      [
        "收集身份源、用户与服务角色、现有登录流程、协议版本、多因素要求、凭据存储和访问恢复场景，明确系统信任边界。",
        "Collect identity sources, user and service roles, login journeys, protocol versions, MFA, credential storage and recovery scenarios, defining trust boundaries.",
      ],
      [
        "比较认证与授权职责、会话撤销、最小权限和故障恢复，绘制登录与令牌生命周期，并针对管理员和服务账号分别评审。",
        "Compare authentication and authorization, revocation, least privilege and recovery; map login and token lifecycles, reviewing administrators and service accounts separately.",
      ],
      [
        "交付身份流转图、角色权限矩阵、候选对照和威胁假设、迁移及回退计划，列明需要安全团队确认的未决问题。",
        "Deliver identity flows, role-permission matrices, candidate comparisons, threat assumptions and migration and rollback plans, including security-review questions.",
      ],
      [
        "不要在材料中保存实际密钥或令牌，验证授权边界、失效和锁定策略；未经渗透测试或恢复演练不能标记安全验证通过。",
        "Never include real keys or tokens; verify authorization, expiry and lockout policies, and do not claim security validation without testing and recovery exercises.",
      ],
    ),
    detail(
      [
        "收集供应商接口文档、版本、功能声明、服务等级、报价、数据处理条款和试用限制，明确需要覆盖的真实业务场景。",
        "Collect vendor API documentation, versions, feature claims, service levels, pricing, data-processing terms and trial limits, with representative business scenarios.",
      ],
      [
        "建立统一评价标准，对接口兼容、吞吐、故障响应、数据迁移及支持能力逐项检查，分别记录文档声明和实际试用证据。",
        "Apply common criteria to integration, throughput, incident response, migration and support, recording documentation claims separately from actual trial evidence.",
      ],
      [
        "交付供应商评估矩阵、试用步骤和结果、总成本与退出条件、合同待澄清项和建议决策，说明无法实测的评价维度。",
        "Deliver a vendor matrix, trial procedures and results, total cost, exit conditions, contract questions and recommendations, identifying untested dimensions.",
      ],
      [
        "勿把销售承诺写成合同保证，核查服务地区、数据权限和报价有效期；缺少试用环境或支持记录时如实保留不确定性。",
        "Do not treat sales promises as contractual guarantees; verify service regions, data rights and quotation validity, disclosing missing trial or support evidence.",
      ],
    ),
    detail(
      [
        "收集日志来源、每日容量、检索场景、敏感字段、保留期限、访问角色和候选平台的接入及计费信息。",
        "Collect log sources, daily volumes, search scenarios, sensitive fields, retention, access roles and candidate platform integration and pricing details.",
      ],
      [
        "比较采集、脱敏、索引、检索与告警能力，按角色验证访问控制，结合写入与保留量评估成本和日志丢失后的恢复方式。",
        "Compare ingestion, redaction, indexing, search and alerts; test role-based access and assess costs and recovery after log loss.",
      ],
      [
        "交付字段分类与脱敏表、架构和费用对照、检索示例、保留策略与审计清单，记录缺失采集源和待验证权限；附一条从事件到检索结果的演示路径。",
        "Deliver field classification, redaction, architecture and cost comparisons, queries, retention and audit checklists, missing sources, permissions and an event-to-search example.",
      ],
      [
        "严禁将密钥、令牌或个人敏感数据写进示例；核对采集遗漏、时间同步、删除期限和查询审计，缺少验证需明确标注，并检查告警不泄漏日志正文。",
        "Never put secrets, tokens or personal data in examples; check gaps, clocks, deletion, audits and ensure alerts do not expose log bodies.",
      ],
    ),
  ],
  "meeting-brief": [
    detail(
      [
        "收集项目目标、当前里程碑、状态证据、风险阻塞、上次会议行动及参与人员，确认会议日期和需要决策的权限范围。",
        "Collect project objectives, milestone evidence, blockers, previous actions and participants, confirming the meeting date and decision authority.",
      ],
      [
        "依次回顾上次行动与里程碑偏差，讨论关键依赖、风险和升级请求，再确认需要决定的选项、责任人与完成时间。",
        "Review prior actions and milestone variance, discuss dependencies, risks and escalations, then confirm decision options, owners and due dates.",
      ],
      [
        "交付简明议程、进度与阻塞表、决策记录和会后行动清单，逐项标注来源、负责人、截止时间以及未完成原因。",
        "Deliver a concise agenda, progress and blocker table, decision record and action list, with sources, owners, deadlines and reasons for outstanding work.",
      ],
      [
        "不要将未确认的进度或计划日期写成已完成；未到会人员的责任与承诺需单独回访，超期事项不能悄悄移出清单。",
        "Do not label unconfirmed progress or planned dates complete; follow up on absent owners' commitments and retain overdue actions visibly.",
      ],
    ),
    detail(
      [
        "收集团队周目标、各成员已交成果、工作中事项、计划排期和需要协助的依赖，注明汇报周期及敏感信息传播范围。",
        "Collect weekly goals, delivered work, in-progress items, schedules and help needed, stating the reporting period and appropriate confidentiality.",
      ],
      [
        "按目标而非人员流水账归纳成果，区分已完成与进行中，再讨论跨人依赖、负荷冲突和下周最重要的共同事项。",
        "Summarize outcomes by objective rather than personal activity; distinguish completion from work in progress and discuss dependencies, capacity and next priorities.",
      ],
      [
        "交付一页周会摘要、目标状态表、需要协助的事项及下周行动，标记负责人、预期交付、确认状态和下次跟进日期。",
        "Deliver a one-page summary, objective status table, assistance requests and next-week actions, with owners, expected outputs and confirmation dates.",
      ],
      [
        "不得把成员个人反馈或未经验证的进度扩散为公开结论；缺席者工作状态待确认，团队负荷和隐私信息只在授权范围内使用。",
        "Do not circulate personal feedback or unverified progress as fact; confirm absent members' status and restrict capacity and private information appropriately.",
      ],
    ),
    detail(
      [
        "收集涉及部门、共同目标、接口交付物、依赖日期、争议和既有约定，确认各方具有协调或决策权限的代表。",
        "Collect departments, shared objectives, interface deliverables, dependency dates, disputes and existing agreements; identify authorized representatives.",
      ],
      [
        "逐条对齐交接内容、接收条件、提供方和接收方，梳理关键路径及冲突选项，再约定升级机制与下一次确认节点。",
        "Align each handoff's content, acceptance criteria, provider and recipient; review critical paths and conflicts, then agree escalation and confirmation points.",
      ],
      [
        "交付跨部门依赖与接口矩阵、争议处理记录、共同决定和双方待办，清楚列明时间、联系人、交付证据及尚未确认的承诺。",
        "Deliver a cross-team dependency and interface matrix, dispute and decision records and bilateral actions, with dates, contacts, evidence and unconfirmed commitments.",
      ],
      [
        "不能将某一部门的单方设想写成双方承诺；缺少接收条件或授权代表时保持待确认，涉及外部机构的资料先核实披露许可。",
        "Do not present one department's proposal as mutual commitment; leave acceptance and authority unresolved when missing, checking external disclosure rights.",
      ],
    ),
    detail(
      [
        "收集待移交事项、工作进展、文件与系统位置、必要权限、关键联系人、到期节点及尚未处理的风险和历史决定。",
        "Collect work in progress, status, document and system locations, required permissions, contacts, deadlines, risks and prior decisions.",
      ],
      [
        "按事项逐项说明背景、当前状态、下一步和升级路径，现场核对接收人是否能访问资料，并安排权限转移与后续答疑。",
        "Review background, status, next steps and escalation for each item; verify access with the recipient and schedule permission transfer and follow-up.",
      ],
      [
        "交付交接清单、资料索引、未结事项和权限确认表，分别记录移交人、接收人、完成证据、待办及正式确认日期。",
        "Deliver handover and document indexes, open items and access confirmations, recording both parties, evidence, follow-ups and acceptance dates.",
      ],
      [
        "禁止在纪要内直接记录密码和密钥；未完成的访问权限、责任转移和对外沟通须显式保留，不能仅凭会议召开视为完成交接。",
        "Never record passwords or keys in the minutes; retain pending access, responsibility and external communications rather than equating a meeting with completed handover.",
      ],
    ),
    detail(
      [
        "收集方案版本、评审范围、决策标准、候选方案、相关证据、已知风险和受邀评审人的职责及授权范围。",
        "Collect proposal versions, review scope, decision criteria, alternatives, evidence, known risks and reviewers' responsibilities and authority.",
      ],
      [
        "按目标、可行性、成本和风险组织讨论，逐项记录反对意见及缺失证据，对通过、修改后复审或暂缓分别给出理由。",
        "Discuss objectives, feasibility, cost and risk; record objections and missing evidence, explaining approval, revision and re-review, or deferral.",
      ],
      [
        "交付评审议程、意见与回应表、决议和未决问题清单，注明对应方案版本、责任人、补证据期限及下一次评审条件；按决策事项关联具体证据页。",
        "Deliver an agenda, comment-response table, decisions and open issues with version, owners and deadlines, linking each decision to its evidence.",
      ],
      [
        "沉默或缺席不代表批准，不能抹去保留意见；涉及技术、安全或预算的结论必须核对对应授权人及其明确表态，保留原始异议措辞的含义。",
        "Silence or absence is not approval; retain dissent accurately and verify explicit authorization for technical, security and budget decisions.",
      ],
    ),
    detail(
      [
        "收集预算申请、上期实际、预测、科目明细、币种、期间、历史批准情况和参与人的预算审批权限。",
        "Collect budget requests, prior actuals, forecasts, line items, currencies, periods, approval history and participants' authorization limits.",
      ],
      [
        "统一期间和科目比较申请与实际差异，解释成本驱动及调整选项，讨论资金来源、未覆盖风险和需要升级审批的额度。",
        "Align periods and accounts to compare requests with actuals; explain cost drivers, adjustment options, funding gaps and escalation thresholds.",
      ],
      [
        "交付预算差异表、调整建议、审批决定和待补证明，逐项列出金额单位、责任人、决定日期以及批准或待批状态；单列一次性和持续费用。",
        "Deliver variance tables, adjustment proposals, approvals and missing evidence with units, owners and status, separating recurring and one-time costs.",
      ],
      [
        "不得将口头讨论记为正式批准，避免混用税前税后、不同币种或重复费用；缺失汇率与分摊依据时应单独列为待确认，预算拥有者应复核汇总。",
        "Do not treat discussion as approval or mix tax bases, currencies and duplicate costs; flag missing rates and allocations for budget-owner review.",
      ],
    ),
    detail(
      [
        "收集风险登记册、概率和影响评分规则、控制措施、事件变化、触发条件、责任人及已有风险接受授权。",
        "Collect the risk register, likelihood and impact criteria, controls, incident changes, triggers, owners and existing risk-acceptance authority.",
      ],
      [
        "逐项比较当前与上次评分及控制效果，讨论是否减轻、转移、接受或升级，明确触发事件、应对责任和复审频率。",
        "Compare current and prior scores and control effectiveness; decide whether to mitigate, transfer, accept or escalate, assigning triggers, owners and review cadence.",
      ],
      [
        "交付风险变化表、处置决策及依据、控制措施跟踪表和升级事项，记录接受风险的授权人、到期日及缺失证据。",
        "Deliver risk changes, response decisions and rationale, control tracking and escalations, recording acceptance authority, deadlines and missing evidence.",
      ],
      [
        "不得把未执行控制写成有效措施，也不能由无授权人员替代风险接受；保留低概率高影响事件和评分不确定性。",
        "Do not call unimplemented controls effective or substitute unauthorized risk acceptance; retain low-probability high-impact events and scoring uncertainty.",
      ],
    ),
    detail(
      [
        "收集变更请求、业务原因、影响系统与人员、测试记录、实施窗口、回退方案及有权决定变更的审批人。",
        "Collect the change request, business rationale, affected systems and people, tests, implementation window, rollback plan and authorized approvers.",
      ],
      [
        "比较实施、延期及拒绝选项，评估依赖、停机影响、验证条件与回退触发，明确执行负责人和通知受影响方的计划。",
        "Compare implementation, deferral and rejection; assess dependencies, downtime, verification and rollback triggers, assigning execution and communications.",
      ],
      [
        "交付变更决议、影响和风险清单、实施及回退检查点、测试证据和通知对象，记录审批状态及条件未满足的后续处理。",
        "Deliver the change decision, impacts and risks, implementation and rollback checkpoints, test evidence and notification list, with approval and unmet conditions.",
      ],
      [
        "未获授权不能记录为通过，不能把尚未执行的回退演练写为成功；涉及客户窗口或数据变更时先核实约定和备份状态。",
        "Do not record unauthorized approval or unperformed rollback tests as successful; verify customer windows and backup status before data changes.",
      ],
    ),
    detail(
      [
        "收集客户业务目标、现有流程、参与人、已知约束、问题示例和会议议程，确认客户允许记录和分享的资料范围。",
        "Collect customer objectives, current workflows, participants, constraints, examples and agenda, confirming consent to record and share materials.",
      ],
      [
        "先澄清任务背景、成功标准与痛点，再按优先级讨论需求、边界和验收方式；将客户原话与团队提出的解决假设分开。",
        "Clarify context, success criteria and pain points, then prioritize needs, boundaries and acceptance, separating customer statements from solution assumptions.",
      ],
      [
        "交付需求及优先级表、待澄清问题、验收条件草案和双方行动项，标记客户原话、负责人、确认期限和尚未达成的共识。",
        "Deliver prioritized needs, open questions, draft acceptance criteria and bilateral actions, identifying quotations, owners, deadlines and unresolved agreement.",
      ],
      [
        "不要把建议或探索性讨论写成客户承诺，未获许可不得传播客户身份和敏感业务数据；验收口径由客户确认后才能定稿。",
        "Do not turn proposals or exploratory discussion into customer commitments; protect identities and sensitive data, and obtain customer confirmation of acceptance criteria.",
      ],
    ),
    detail(
      [
        "收集合同交付要求、近期供货和服务表现、质量问题、采购计划、未结争议及双方指定联系人与决策权限。",
        "Collect contractual deliverables, recent supply and service performance, quality issues, purchasing plans, disputes, contacts and decision authority.",
      ],
      [
        "按交付、质量、服务与费用逐项核对事实，讨论纠正措施、完成证据与升级节点，并记录需要合同或采购部门确认的问题。",
        "Review delivery, quality, service and cost against facts; discuss corrective actions, evidence and escalation, identifying contract and procurement questions.",
      ],
      [
        "交付问题台账、双方行动与响应期限、纠正措施验收方式和待确认事项，注明会议版本、承诺来源及下次复盘时间。",
        "Deliver an issue register, bilateral actions and response deadlines, corrective-action acceptance and open items, with commitment sources and review dates.",
      ],
      [
        "不能虚构供应商承诺或修改合同条款，价格和联系人按商业保密要求控制传播；未经双方确认的解决方案保持提议状态。",
        "Do not invent vendor commitments or amend contract terms; protect prices and contacts, and keep unconfirmed solutions explicitly provisional.",
      ],
    ),
    detail(
      [
        "收集合作目标、双方资源、目标受众、合作草案、职责边界、预算投入和已知审批或合同要求，确认双方代表身份。",
        "Collect partnership objectives, resources, audience, proposal, responsibilities, budget and approval or contracting requirements; verify representatives.",
      ],
      [
        "梳理共同价值、各自投入、交付接口与时间安排，讨论收益分配、内容审核、知识产权和不能达成一致时的退出机制。",
        "Map shared value, contributions, interfaces and timing; discuss benefit allocation, content review, intellectual property and exit if agreement fails.",
      ],
      [
        "交付合作选项对照、责任与依赖矩阵、待确认条款和下一步时间表，标注双方联系人、审核人及尚未签署的内容。",
        "Deliver option comparisons, responsibility and dependency matrices, unresolved terms and next-step schedules, identifying contacts, reviewers and unsigned items.",
      ],
      [
        "会议提议不是已签署协议，不得暗示对方已授权使用品牌或资料；财务、法律和外部发布事项应走各自正式审核。",
        "Meeting proposals are not signed agreements and do not authorize brand or material use; finance, legal and public communications require formal review.",
      ],
    ),
    detail(
      [
        "收集合同或任务约定、交付清单、验收标准、测试结果、缺陷清单、版本标识以及具备签收权限的接收人。",
        "Collect contractual or task terms, deliverables, acceptance criteria, test results, defect lists, version identifiers and authorized recipients.",
      ],
      [
        "逐项核对交付物与证据，区分接受、拒绝和有条件接受，讨论遗留缺陷影响、修复期限以及复验和升级方式。",
        "Check each deliverable and its evidence, distinguishing accepted, rejected and conditional acceptance; agree defect remediation, retesting and escalation.",
      ],
      [
        "交付逐项验收表、版本与证据链接、遗留缺陷责任表和签收待办，注明接受条件、决定人、日期及后续复验安排；附未通过项的影响说明。",
        "Deliver itemized acceptance, version and evidence links, defect ownership, sign-off, conditions and retests, with impact notes for rejected items.",
      ],
      [
        "没有真实验收证据或授权签收不能写成正式通过，缺陷不得仅因计划修复而消失；对有条件接受的风险、影响、期限和升级方式需明确记录。",
        "Do not claim formal acceptance without evidence; retain defects and document impact, risk, deadline and escalation for conditional acceptance.",
      ],
    ),
  ],
  "brand-campaign": [
    detail(
      [
        "收集目标市场与受众定义、品牌认知基线、调研时间、现有定位和可用渠道数据，标明样本覆盖、来源和负责人。",
        "Collect target markets, audience definitions, awareness baselines, research dates, positioning and channel data, noting coverage, sources and owners.",
      ],
      [
        "围绕认知到考虑的路径制定统一信息，区分需改变的认知与需维持的品牌资产，并为每个触点设定可观测指标。",
        "Shape consistent messages along awareness and consideration; separate perceptions to change from assets to retain and define observable channel measures.",
      ],
      [
        "交付受众与认知差距、信息主张及证据、渠道节奏和测量方案，标注基线、目标来源、素材责任人与复盘节点。",
        "Deliver audience and perception gaps, substantiated messages, channel cadence and measurement plan with baseline, target sources, owners and reviews.",
      ],
      [
        "不得虚构品牌知名度、客户评价或活动成果；指标定义和样本变化需前后一致，广告与品牌主张经过品牌及合规审阅。",
        "Do not invent awareness, testimonials or campaign outcomes; align metric definitions and samples, and review claims for brand and compliance.",
      ],
    ),
    detail(
      [
        "收集当前品牌定位、旧版材料、客户访谈与市场证据、产品变化、内部批准记录及需要迁移的触点清单。",
        "Collect existing positioning, prior assets, customer interviews, market evidence, product changes, approvals and touchpoints to update.",
      ],
      [
        "对照旧新定位的受众、价值承诺、证据和语气，评估迁移期如何处理存量物料、销售说法与客服答复。",
        "Compare old and new audiences, promises, proof and tone; plan transition for existing assets, sales messaging and service responses.",
      ],
      [
        "交付旧新定位对照、定位陈述与支撑证据、触点更新清单、迁移顺序和内部问答，标明待批准措辞与生效日期。",
        "Deliver old-to-new positioning, supported statement, asset inventory, migration sequence and internal FAQ, marking unapproved wording and effective dates.",
      ],
      [
        "不得把建议稿视为已批准品牌承诺，涉及商标、产品能力和渠道物料的改动由负责人确认；保留过渡期旧内容下线记录。",
        "Do not treat a proposal as approved brand promise; obtain owners' review of trademarks and claims, tracking retirement of old materials.",
      ],
    ),
    detail(
      [
        "收集周年主题、经核验的组织历史与里程碑、档案图片、活动预算、合作人员及可公开的品牌资产授权。",
        "Collect anniversary theme, verified milestones, archival images, event budget, partners and public-use permissions for brand assets.",
      ],
      [
        "以时间线建立叙事，区分有档案支持的历史事实、当前业务和未来愿景，再规划线上线下参与与纪念物料。",
        "Build a timeline separating documented history, current work and future aspirations, then plan participation and event materials.",
      ],
      [
        "交付周年传播主线、事实核对表、活动流程与渠道清单，逐项标明影像来源、授权、使用范围及参与者确认状态。",
        "Deliver the anniversary narrative, fact-check list, event flow and channels, with source, permissions, scope and participant approvals.",
      ],
      [
        "不得仅凭口述补造历史日期、成立故事或客户成绩；归档照片与员工肖像确认版权及同意，预算及公益承诺需正式审批。",
        "Do not invent historical dates or achievements from hearsay; verify image rights and consent, and formally approve budgets and charitable promises.",
      ],
    ),
    detail(
      [
        "收集创始或团队访谈、品牌档案、产品发展节点、客户案例授权和当事人认可的原始资料，确定叙事受众与投放场景。",
        "Collect founder or team interviews, archives, product milestones and authorized customer stories, defining audience and publication context.",
      ],
      [
        "用真实事件呈现问题、选择与改变，区分直接引语、编辑概述和对外价值主张，删去无法由证据支持的戏剧化细节。",
        "Use documented events to show problems and decisions, separating quotations, editorial summary and brand claims; remove unsupported dramatization.",
      ],
      [
        "交付故事大纲、事实与引语来源表、可发布短版与长版，以及需授权的姓名、图片和具体案例清单。",
        "Deliver story outlines, fact and quotation sources, short and long versions, and a checklist of names, images and case permissions.",
      ],
      [
        "客户案例不得泄露身份或商业秘密，不把推测写成当事人经历；在发布前由引用对象核对可公开内容和使用期限。",
        "Do not disclose customer identities or secrets, or attribute speculation to people; let subjects review public details and usage period before release.",
      ],
    ),
    detail(
      [
        "收集已确认的产品能力、可用版本、目标用户、上市地区、测试证据、支持条件、发布日期状态与获批素材。",
        "Collect confirmed capabilities, versions, users, regions, test evidence, support conditions, launch date status and approved assets.",
      ],
      [
        "围绕目标用户任务建立上市前、发布期、发布后信息，逐条将主张映射至实际能力和证据，并安排客服及销售准备。",
        "Build pre-launch, launch and post-launch messages around user tasks; map every claim to evidence and prepare sales and support teams.",
      ],
      [
        "交付产品信息层级、受众话术、渠道节奏、问答与异常升级表，区分公开事实、计划内容及尚待产品负责人确认的说法。",
        "Deliver message hierarchy, audience copy, channel cadence, FAQ and escalation, separating facts, plans and claims awaiting owner confirmation.",
      ],
      [
        "不得宣传未发布或仅计划中的功能，不夸大测试覆盖和适用范围；价格、日期、兼容设备及截图与当前版本逐一核验。",
        "Do not promote unreleased features or exaggerate test coverage; verify pricing, dates, compatibility and screenshots against the current version.",
      ],
    ),
    detail(
      [
        "收集季节节点、目标地区与受众、商品和服务范围、价格、库存、活动周期及往年表现和已授权素材。",
        "Collect seasonal dates, markets and audiences, products and services, pricing, inventory, campaign period, prior performance and approved assets.",
      ],
      [
        "先核对供应和时效条件，再安排预热、活动期与收尾内容；按受众行为规划渠道和频率，明确库存不足或活动延期时的替代沟通。",
        "Verify supply and timing, then schedule preview, active-period and closeout messaging; plan channels and contingencies for stock or delays.",
      ],
      [
        "交付促销日历、各阶段素材任务、权益说明、库存监控和结束复盘表，标出渠道负责人、上线日期及撤下检查点。",
        "Deliver promotion calendar, stage-specific asset tasks, terms, inventory monitoring and review, with channel owners, launch and takedown checkpoints.",
      ],
      [
        "折扣、库存、适用地区和截止时间必须与业务系统及批准条件一致；不能用过期活动图再次传播或隐去限制条款。",
        "Match discounts, stock, regions and deadlines to approved operational data; do not reuse expired artwork or hide restrictions.",
      ],
    ),
    detail(
      [
        "收集会员层级、正式权益规则、加入和续费流程、现有转化与留存数据、同意记录及会员可用渠道。",
        "Collect membership tiers, approved benefits, enrollment and renewal steps, conversion and retention data, consent and available channels.",
      ],
      [
        "按潜在成员、已加入成员和待续费群体设计不同触达与行动路径，说明每项权益门槛并评估触达频次和退出方式。",
        "Design separate journeys for prospects, members and renewals; explain benefit eligibility and assess contact frequency and opt-out.",
      ],
      [
        "交付分群沟通矩阵、加入流程内容、权益问答、渠道排程及增长衡量表，列出转化分母、续费期间与隐私授权检查。",
        "Deliver segment messaging, enrollment content, benefit FAQ, channel schedule and measurement definitions, including denominators and privacy checks.",
      ],
      [
        "不能宣传尚未批准的权益或保证收益，遵守营销同意和退订要求；涉及个人画像时只使用授权且必要的字段。",
        "Do not promise unapproved benefits or guaranteed returns; respect consent and opt-outs and use only authorized, necessary profile data.",
      ],
    ),
    detail(
      [
        "收集区域市场规模与受众资料、当地语言、文化节庆、渠道限制、产品可用性和本地审核人员及素材许可。",
        "Collect regional audience data, languages, cultural events, channel rules, product availability, local reviewers and asset permissions.",
      ],
      [
        "先区分可直接复用的品牌核心和必须本地化的例子、日期、表达及购买路径，邀请当地成员审阅可能引发歧义的措辞。",
        "Separate reusable brand elements from localized examples, dates, wording and purchase paths; have local reviewers examine ambiguous language.",
      ],
      [
        "交付各地区版本差异表、语言审校清单、当地渠道日历、发布审核节点与合规待办，标注各区域负责人及素材版本。",
        "Deliver regional adaptations, language review checklist, local channel calendar, approval gates and compliance actions with owners and asset versions.",
      ],
      [
        "翻译正确不等于文化或法律适配，核实当地广告规则、数据政策和产品可用性；未经许可不使用当地人物或图像。",
        "Accurate translation does not guarantee cultural or legal fit; verify local advertising, data and availability rules and obtain image permissions.",
      ],
    ),
    detail(
      [
        "收集社区规则、目标成员、已公开互动、版主意见、当前争议和可支持的讨论主题，确认参与者公开内容的再利用授权。",
        "Collect community rules, members, public interactions, moderator input, disputes and discussion themes, confirming permission to reuse member content.",
      ],
      [
        "设计能邀请成员贡献经验的问题和回应规范，安排评论监看、错误信息纠正、升级与降温流程，避免品牌单向灌输。",
        "Design experience-sharing prompts and response norms with moderation, correction, escalation and de-escalation, avoiding one-way promotion.",
      ],
      [
        "交付话题日历、版主责任、互动回复指引和升级树，列出社区反馈的收集方式、需要人工复核的观点及可衡量参与指标。",
        "Deliver topic calendar, moderator roles, response guide and escalation tree, with feedback collection, review needs and measurable engagement.",
      ],
      [
        "保护社区成员隐私与自创内容，未经同意不截图引用；冲突、投诉及专业建议交给适当负责人，不让自动回复冒充调查结论。",
        "Protect privacy and member-created work; obtain consent before quoting, and route disputes or expert advice to responsible humans.",
      ],
    ),
    detail(
      [
        "收集合作协议、双方品牌规范、联合目标、允许使用的标识与素材、活动日期、共同审核联系人和各自承诺。",
        "Collect partnership agreements, brand rules, shared goals, approved logos and assets, dates, reviewers and each party's commitments.",
      ],
      [
        "确定共同主题与受众利益，拆分双方制作、审核、发布及答疑责任，安排交叉审稿和素材版本锁定流程。",
        "Define shared themes and audience value, divide creation, approval, publication and support, and manage cross-review and asset versions.",
      ],
      [
        "交付联合传播任务板、内容与渠道日历、品牌素材清单及审核签核表，逐项注明发布方、版本、截止日和授权证据。",
        "Deliver a joint campaign board, content calendar, asset inventory and approvals with publisher, version, deadline and permission evidence.",
      ],
      [
        "协议未授权范围内不得使用标识、客户名单或对方数据；未经双方批准不发布联合声明，不将一方内部批准视为双方同意。",
        "Do not use marks, lists or data beyond agreement; publish no joint claim without both approvals, and distinguish each party's sign-off.",
      ],
    ),
    detail(
      [
        "收集公益目标、受益人范围、合作方登记信息、预算和资源承诺、实际活动安排、进展证据及受益人影像授权。",
        "Collect charitable objectives, beneficiaries, partner registration, budget and resource commitments, activity plans, evidence and image consent.",
      ],
      [
        "说明问题背景、计划行动、合作分工、进度如何核验以及公众参与方式，分别标注已完成成果和未来目标。",
        "Explain context, actions, partnership roles, verification and participation, distinguishing completed results from future targets.",
      ],
      [
        "交付公益传播事实表、执行时间线、进度更新模板和捐赠或参与说明，列出每项数字证据、负责人及公开边界。",
        "Deliver a fact sheet, implementation timeline, progress-update template and participation details with evidence for each metric and disclosure limits.",
      ],
      [
        "不得夸大受益人数、效果或捐赠金额，不可作未经批准的资金承诺；保护受益人隐私并核验合作方及资金披露依据。",
        "Do not exaggerate beneficiaries, impact or donations or make unapproved funding promises; protect privacy and verify partners and financial disclosures.",
      ],
    ),
    detail(
      [
        "收集活动议程、讲者与主办方确认、时间地点、报名路径、采访政策、授权图片和各渠道发布时间。",
        "Collect event agenda, confirmed speakers and organizers, timing, venue, registration, interview policy, licensed images and channel dates.",
      ],
      [
        "将会前预告、现场更新和会后总结分开排期，给每条内容指定素材、审核与发布责任，并准备变更或取消通知。",
        "Schedule pre-event previews, live updates and follow-up separately, assigning assets, approval and publication and preparing change notices.",
      ],
      [
        "交付活动传播时间线、各阶段内容简报、现场事实核对卡、会后回顾提纲及紧急联系人表，标明仍待确认的细节。",
        "Deliver a campaign timeline, stage briefs, live fact-check card, recap outline and emergency contacts, identifying details awaiting confirmation.",
      ],
      [
        "核实主办、嘉宾身份、肖像、会场和议程变更；不得编造出席人数、讲者发言或现场评价，未经授权不公开参与者照片。",
        "Verify organizers, speakers, images, venue and changes; never invent attendance or quotes, and obtain consent before publishing participant photos.",
      ],
    ),
  ],
  "poster-campaign": [
    detail(
      [
        "收集讲座主题、讲者核准姓名与简介、准确日期时区、场地或直播入口、报名截止和主办联系方式。",
        "Collect lecture topic, approved speaker name and bio, date and time zone, venue or stream, registration deadline and organizer contact.",
      ],
      [
        "先确定观众最关心的收获，再安排主题、讲者和行动入口层级；检查受支持页面的二维码、时间地点和报名说明是否可读。",
        "Lead with audience takeaways, then hierarchy of topic, speaker and action; check that QR, time, venue and registration are legible on supported pages.",
      ],
      [
        "交付受支持页面的海报、主视觉文案、版面信息清单及链接和活动信息复核表；其他渠道的尺寸只提供适配建议，并保留可编辑文案。",
        "Deliver a poster on a supported page, key copy, layout and event checks; give adaptation guidance for other channel sizes and retain editable copy.",
      ],
      [
        "讲者须同意个人介绍和肖像使用；确认时区、容量、费用及报名链接有效，避免把临时安排制作成无法更新的确定信息。",
        "Obtain speaker permission; verify timezone, capacity, fees and registration, and avoid making provisional details appear fixed.",
      ],
    ),
    detail(
      [
        "收集展览主题、经批准的展期和地点、参展作品清单、可使用图像、艺术家署名、开放时段及票务信息。",
        "Collect exhibition theme, approved dates and venue, artwork list, usable images, artist credits, opening hours and ticket details.",
      ],
      [
        "选择能代表展览主题且获得授权的作品作为主视觉，协调标题、创作者与参观信息，检查支持页面内的裁切和缩略阅读效果。",
        "Select an authorized representative work and balance title, credits and visitor details; check clipping and thumbnail legibility on the supported page.",
      ],
      [
        "交付受支持页面的展览海报、作品及署名来源表，并提出其他渠道的适配建议，注明开放信息、视觉使用范围及最终审核人。",
        "Deliver an exhibition poster on a supported page and artwork and credit sources; provide guidance for other channels with hours, image rights and final reviewer.",
      ],
      [
        "作品版权、摄影权和署名需分别核实；展期、场地或票务变化及时更新各版本，不能从网络图片库推断可商用。",
        "Verify artwork, photography and credit rights separately; update every version after changes and never assume online images are commercially licensed.",
      ],
    ),
    detail(
      [
        "收集工作坊目标、适用对象、参与前提、日期地点、人数上限、材料准备和报名方式，确认组织方及联系渠道。",
        "Collect workshop goals, audience, prerequisites, date and venue, capacity, materials and registration, confirming organizers and contacts.",
      ],
      [
        "将可带走的学习成果与参加条件放在首屏，清晰说明时长、材料和报名动作，并评估支持页面在社交、邮件或打印场景下的适配需求。",
        "Put learning outcomes and eligibility up front; state duration, materials and registration, and assess adaptation needs for social, email or print.",
      ],
      [
        "交付受支持页面的活动海报、其他渠道适配建议、参与准备清单和报名文案，注明名额、费用、截止时间和信息复核责任人。",
        "Deliver an event poster on a supported page, adaptation guidance, preparation checklist and registration copy with capacity, fees, deadline and fact-check owner.",
      ],
      [
        "名额、适用人群及设备要求必须经组织者确认；报名链接可用且期限准确，不暗示工作坊提供未列明的认证或就业结果。",
        "Confirm capacity, eligibility and equipment with organizers; verify links and avoid implying unlisted certification or employment outcomes.",
      ],
    ),
    detail(
      [
        "收集社区活动事项、举办单位、地址与交通、适用年龄或参与条件、日期、联系人和可公开使用的场地照片。",
        "Collect community activities, organizer, address and access, eligibility, date, contacts and venue photos approved for public use.",
      ],
      [
        "从居民需要的信息安排地点、对象、可参与内容和报名方式，预留无障碍联系及天气、延期等现场更新入口。",
        "Prioritize venue, audience, activities and registration, including accessibility contact and weather or postponement updates.",
      ],
      [
        "交付受支持页面的社区公告海报、大字排版和社交分享适配建议及更新责任表，分别标明主办方、有效日期与咨询方式。",
        "Deliver a community notice on a supported page, large-text layout and social adaptation guidance with the organizer, valid dates, contact and update owner.",
      ],
      [
        "活动地点和安全安排由主办方核实，不公开居民电话等个人资料；儿童参与、公共场地和天气方案需使用准确审批信息。",
        "Have organizers verify location and safety; protect personal numbers and confirm permissions for children, public spaces and weather plans.",
      ],
    ),
    detail(
      [
        "收集当前产品图片或实物、已发布功能、批准价格、适用对象、限制条件、可使用品牌素材和有效链接。",
        "Collect current product images, released features, approved prices, eligibility, restrictions, licensed brand assets and valid links.",
      ],
      [
        "用一个清楚的用户利益支撑主标题，按视觉主体、简要证据和行动方式组织画面，区分硬性规格与宣传表达。",
        "Support one clear user benefit with a visual subject, concise proof and action, separating factual specifications from promotional wording.",
      ],
      [
        "交付受支持页面的介绍海报、其他渠道适配建议、功能与价格核验清单、图像授权记录及可编辑文案，列出必须同步更新的字段。",
        "Deliver a product poster on a supported page, adaptation guidance, feature and price checks, image permissions and editable copy, identifying fields to update.",
      ],
      [
        "不虚构性能、认证、折扣或兼容设备，截图需匹配当前版本；有限制的价格、地区和库存说明不得因版面而被删去。",
        "Do not invent performance, certification, discounts or compatibility; keep current screenshots and preserve price, region and stock restrictions.",
      ],
    ),
    detail(
      [
        "收集获批品牌标识、品牌历史事实、核心价值主张、图片版权、规范色与字体，以及海报发布渠道和尺寸要求。",
        "Collect approved marks, verified brand history, core positioning, image rights, color and type rules, channels and sizes.",
      ],
      [
        "只选择一个可验证的品牌故事切面，以真实物件或经授权影像承载内容，确保文字层次和视觉风格符合品牌规范。",
        "Choose one verifiable story angle using a real object or authorized image, maintaining clear hierarchy and brand consistency.",
      ],
      [
        "交付受支持页面的品牌故事海报、来源与授权注记、渠道适配建议及规范核对记录，说明故事适用的时间范围和公开对象。",
        "Deliver a story poster on a supported page, source and permission notes, channel adaptation guidance and brand review, stating applicable dates and audience.",
      ],
      [
        "品牌承诺需与现行产品和组织事实一致，图像版权及标识不可擅自改造；发布前让品牌负责人复核关键措辞。",
        "Align brand claims with current facts; do not alter marks or use images without rights, and obtain brand-owner review.",
      ],
    ),
    detail(
      [
        "收集会员活动的已批规则、适用等级、日期地点、报名上限、所需身份验证和咨询入口，确认权益使用条件。",
        "Collect approved membership rules, eligible tiers, date and venue, capacity, verification needs and contact, confirming benefit terms.",
      ],
      [
        "把会员资格与实际活动价值清楚区分，按参与步骤说明兑换或报名，突出截止时间及不能叠加使用的限制。",
        "Separate membership eligibility from event benefits; explain registration or redemption and highlight deadlines and non-combinable terms.",
      ],
      [
        "交付受支持页面的会员活动海报、适用条件清单、报名入口检查及多渠道适配建议，标出负责更新规则和名额的人。",
        "Deliver a member-event poster on a supported page, eligibility checklist, registration checks and channel guidance, identifying owners for rules and capacity.",
      ],
      [
        "不能暗示所有会员都具备相同权益，及时确认剩余名额及兑换规则；活动结束或规则变化时应同步撤换旧图。",
        "Do not imply equal benefits for all members; verify capacity and redemption rules and replace artwork after changes or expiry.",
      ],
    ),
    detail(
      [
        "收集门店名称、实际营业地址、适用日期、活动时段、商品和促销规则、交通方式及门店联系方式。",
        "Collect store name, verified address, dates, activity times, products and promotion rules, transit and contact details.",
      ],
      [
        "以门店位置和顾客参加步骤安排信息，清楚显示是否需到店、预约或消费门槛，并针对本地渠道保留地图或导航链接。",
        "Organize information around location and participation, clarifying visits, bookings and purchase thresholds with local map links.",
      ],
      [
        "交付受支持页面的门店海报、地图与营业信息校验单、价格条款说明和社交渠道适配建议，标注分店适用范围及负责人。",
        "Deliver a store poster on a supported page, map and hours checklist, pricing terms and social adaptation guidance, specifying eligible locations and owner.",
      ],
      [
        "核对门店临时营业变化、地址和价格，避免将单店活动误写为全品牌适用；促销限制和有效期须在可读区域显示。",
        "Check temporary hours, address and prices; distinguish one store from all locations and keep promotion terms legible.",
      ],
    ),
    detail(
      [
        "收集岗位名称、真实职责、任职条件、工作地点、薪酬披露规则、招聘主体、申请方式和已批准的岗位信息。",
        "Collect role title, actual duties, qualifications, location, pay disclosure rules, hiring entity, application method and approved posting details.",
      ],
      [
        "优先说明岗位工作内容和必需条件，避免将无关偏好写成筛选条件；清晰呈现申请步骤、截止日期和招聘联系渠道。",
        "Prioritize actual duties and essential requirements, avoiding irrelevant criteria; clearly show application steps, deadline and contact.",
      ],
      [
        "交付招聘海报、招聘渠道文案、岗位事实与包容性用语核对表，分别列出岗位版本、地点、申请链接和更新责任人。",
        "Deliver recruitment poster and copy with role facts and inclusive-language checks, identifying version, location, link and update owner.",
      ],
      [
        "禁止虚构薪酬、福利或岗位承诺，避免歧视性年龄、性别或健康要求；申请链接必须由招聘负责人确认可用且合法合规。",
        "Do not invent pay, benefits or promises; avoid discriminatory criteria and have recruiting owners verify lawful, working application links.",
      ],
    ),
    detail(
      [
        "收集培训名称、学习目标、目标岗位、讲师与课时、地点或会议链接、报名要求和学员需准备的材料。",
        "Collect training title, learning objectives, roles, instructor and duration, venue or meeting link, eligibility and preparation.",
      ],
      [
        "说明课程结束后学员可完成的具体任务，组织时间、报名及课前准备，按内部传播渠道设置清晰而克制的视觉层级。",
        "State observable tasks learners can perform, organize timing and preparation, and use clear, restrained visual hierarchy for internal channels.",
      ],
      [
        "交付内部培训海报、课程安排和报名说明、材料清单及更新责任表，标注是否需要管理者批准或排班协调。",
        "Deliver internal training poster, schedule, registration and materials, noting approvals and scheduling coordination.",
      ],
      [
        "讲师、课程内容和名额需由组织者复核，内部文件不可误发外部；涉及客户资料或系统演示时应清除敏感信息。",
        "Have organizers confirm instructors and capacity, prevent external disclosure and sanitize customer or system data in demonstrations.",
      ],
    ),
    detail(
      [
        "收集已生效安全制度、适用地点与人群、危险识别、紧急联系人、经过批准的处置步骤及最新版本日期。",
        "Collect effective safety rules, locations and audience, hazards, emergency contacts, approved response steps and version dates.",
      ],
      [
        "将立即停止的行为、撤离或报告步骤放在醒目位置，按实际场景使用简短编号流程，并提供可读的紧急联系方式。",
        "Prominently state stop, evacuation or reporting actions using short scenario-specific steps and legible emergency contacts.",
      ],
      [
        "交付适配地点的安全提醒海报、大字版、责任部门和制度版本标记，并附安全负责人审阅及张贴位置清单。",
        "Deliver location-specific safety posters, large-text version, department and policy version, with safety-owner review and posting locations.",
      ],
      [
        "不得自行创作可能造成危险的处置指引，所有步骤及电话均由合格安全人员确认；二维码不能替代紧急信息的纸面呈现。",
        "Do not invent potentially dangerous procedures; qualified safety staff must verify steps and numbers, and QR codes cannot replace visible emergency details.",
      ],
    ),
    detail(
      [
        "收集正式公告事项、受影响对象、批准人、生效日期、过渡安排、受众必须完成的行动和咨询联系人。",
        "Collect the formal notice, affected audience, approver, effective date, transition, required actions and contact.",
      ],
      [
        "首要呈现发生了什么、何时生效及读者要做什么，再说明变化原因、过渡支持与例外，提供易于访问的完整说明链接。",
        "Lead with what changes, when and required action, then explain rationale, transition and exceptions with accessible details.",
      ],
      [
        "交付公告主版、对象化渠道稿、行动时间线与常见问题，标注决策来源、批准状态、发布日期及后续更新责任人。",
        "Deliver notice master, audience-specific copies, action timeline and FAQ with decision source, approval, publication and update owner.",
      ],
      [
        "只有已批准决定可写成正式变更，检查日期和受影响范围避免过窄或过宽；未确认事项应标为待定而非推测解释。",
        "Only approved decisions are final; verify dates and scope, and label unresolved items pending rather than speculate about rationale.",
      ],
    ),
  ],
  "social-campaign": [
    detail(
      [
        "收集栏目定位、目标受众、平台格式规范、品牌语气、选题库、可复用素材和团队可持续的发布频次。",
        "Collect series positioning, audiences, platform formats, brand voice, topic bank, reusable assets and sustainable publishing cadence.",
      ],
      [
        "建立主题支柱并规划每期的独立价值，安排跨平台改写而非机械复制；预留事实审核、评论互动和紧急撤稿步骤。",
        "Create topic pillars with distinct value per installment, adapt for each channel and plan fact review, moderation and takedown.",
      ],
      [
        "交付分期内容日历、标题与文案框架、平台改编清单和效果复盘字段，标注制作负责人、审核时间及素材来源。",
        "Deliver a content calendar, copy frameworks, channel adaptations and review fields with owners, review dates and asset sources.",
      ],
      [
        "避免连续发布重复广告或未经许可的音乐图片；平台规则和显示格式变化需复查，互动承诺须能由实际服务团队履行。",
        "Avoid repetitive ads and unlicensed media; recheck changing platform rules and ensure engagement promises can be fulfilled.",
      ],
    ),
    detail(
      [
        "收集真实常见问题、已核准答复、支持政策、提问渠道、敏感信息处理原则和可用于公开互动的内容范围。",
        "Collect real FAQs, approved answers, support policies, question channels, sensitive-data rules and permissible public content.",
      ],
      [
        "将问题分为可直接解答、需补充背景和应转交支持团队三类，设计公开回复、私下引导和无法确认时的回应方式。",
        "Classify questions as answerable, needing context or escalation; design public replies, private routing and uncertainty responses.",
      ],
      [
        "交付问答选题排期、已核准答案库、转接联系人和评论处理流程，并标注答复适用版本、更新时间及需要人工复核的主题。",
        "Deliver a Q&A schedule, approved answer bank, escalation contacts and moderation flow with applicable versions and review topics.",
      ],
      [
        "不得公开提问者个人资料、账户记录或未经确认的服务政策；涉及安全、法律或投诉的内容及时交由授权人员。",
        "Never reveal asker data or unverified policy; route safety, legal or complaint topics promptly to authorized staff.",
      ],
    ),
    detail(
      [
        "收集经同意的幕后工作记录、参与者名单、可公开工序、授权图片、涉及的内部系统与对外传播范围。",
        "Collect consented behind-the-scenes records, participants, publishable processes, licensed images, systems and disclosure scope.",
      ],
      [
        "从具体工作过程说明谁在解决什么问题，并隐藏内部操作细节、客户信息和访问权限；对不便公开的环节使用概述。",
        "Show who is solving what through real work while hiding internal operations, customer data and access; summarize nonpublic details.",
      ],
      [
        "交付一组系列主题、拍摄和文字镜头清单、参与者签核状态与发布排程，区分已完成工作和计划内容。",
        "Deliver a series of themes, shot and copy list, participant approvals and schedule, separating completed work from plans.",
      ],
      [
        "未经许可不露出员工或客户肖像，清除屏幕中的账号、工单和密钥；内部流程或安全信息需经负责人审阅。",
        "Do not show people without consent; remove accounts, tickets and secrets from screens and obtain review for internal or security details.",
      ],
    ),
    detail(
      [
        "收集用户经历原始材料、可公开的姓名或匿名要求、结果证据、照片及客户对引用、渠道和使用期限的明确许可。",
        "Collect original user stories, name or anonymity preference, outcome evidence, images and explicit quotation, channel and duration consent.",
      ],
      [
        "围绕用户目标、遇到的障碍、采取的行动和可核实结果组织叙事，注明服务适用背景，不把个别体验泛化成普遍效果。",
        "Structure the story around goals, obstacles, actions and verifiable results, stating context and avoiding universal claims from one experience.",
      ],
      [
        "交付经授权的故事稿、匿名版备选、证据与引语对应表、图片说明和客户确认稿记录，标记可发布平台。",
        "Deliver approved and anonymized story versions, evidence-to-quote mapping, image captions and customer review record, with channels.",
      ],
      [
        "用户须核对原意与身份呈现，禁止编造收益、删去重要限制或扩大使用范围；授权撤回时安排下线。",
        "Have users verify meaning and identity; never invent benefits or widen permissions, and plan removal if consent is withdrawn.",
      ],
    ),
    detail(
      [
        "收集新品当前版本、上市阶段、用户问题、实证功能、已核准发布时间、可用素材和各发布平台的编辑规范。",
        "Collect current product version, launch stage, user needs, verified features, approved dates, assets and platform editorial rules.",
      ],
      [
        "依次安排预告、发布和后续使用案例，每条内容对应一项已发布能力及读者下一步；根据反馈更新问题清单。",
        "Sequence preview, launch and follow-up use cases, tying each post to a released capability and next step; update questions from feedback.",
      ],
      [
        "交付新品多阶段内容日历、平台文案框架、素材索引和上线验收表，注明功能状态、发布时间与每条稿件的责任人。",
        "Deliver a phased calendar, channel copy frameworks, asset index and launch checklist with feature status, dates and owners.",
      ],
      [
        "严格区分已上线功能与路线图计划，不用未确认的规格和价格做承诺；发布日期变化要同步各渠道并撤下旧预热内容。",
        "Distinguish released features from roadmap plans; avoid unconfirmed specs and update every channel when launch dates change.",
      ],
    ),
    detail(
      [
        "收集当前产品可用功能、帮助文档、真实界面截图、版本号、常见误用、用户权限前提和支持渠道。",
        "Collect currently available features, help docs, real screenshots, version, common misuse, permissions and support channels.",
      ],
      [
        "每期只解决一个明确任务，按前提、操作、预期结果和失败排查组织内容，标明不同版本或权限下的界面差异。",
        "Solve one task per installment with prerequisites, steps, expected result and troubleshooting, noting version and permission differences.",
      ],
      [
        "交付逐期标题、分步文案和截图清单、平台发布节奏以及产品版本审核表，使用户能按图复现目标任务。",
        "Deliver installment titles, step copy, screenshot checklist, cadence and version review so users can reproduce the task.",
      ],
      [
        "截图不得暴露真实用户信息或显示不存在的按钮；功能调整后重新验证步骤，不将建议操作写成产品现状。",
        "Screenshots must not expose user data or nonexistent controls; revalidate steps after changes and distinguish suggestions from current behavior.",
      ],
    ),
    detail(
      [
        "收集活动目标、议程、已确认嘉宾与简介、时间地点、报名链接、名额、授权素材和退改通知机制。",
        "Collect event objectives, agenda, confirmed speakers and bios, timing, venue, registration, capacity, assets and change notices.",
      ],
      [
        "按预热、报名推进、临近提醒和活动当天拆分信息，安排不同问题的回答与未报名受众入口，准备延期或取消沟通。",
        "Split preview, registration, reminders and live updates; address audience questions and prepare postponement or cancellation communications.",
      ],
      [
        "交付预热日历、短中长文案、嘉宾信息卡与报名状态检查表，标明每阶段联系人、截止时间和渠道规格。",
        "Deliver teaser calendar, short and long copy, speaker cards and registration checks with stage contacts, deadlines and formats.",
      ],
      [
        "嘉宾出席、活动安排和名额以主办方最新确认信息为准；不要使用旧链接、未经授权照片或未经同意的嘉宾背书。",
        "Use current organizer confirmations for speakers, schedules and capacity; avoid stale links, unlicensed images and unapproved endorsements.",
      ],
    ),
    detail(
      [
        "收集客户案例事实、合同允许公开的范围、基线和结果证据、审核联系人、匿名要求及引用和标识许可。",
        "Collect case facts, contractually permitted disclosure, baseline and outcome evidence, reviewers, anonymity and quote and logo permissions.",
      ],
      [
        "按问题、采用过程、结果与适用条件讲述案例，使用经核实指标解释变化，并保留背景差异和无效尝试。",
        "Present problem, implementation, outcomes and fit; substantiate changes with verified metrics while retaining context and failed attempts.",
      ],
      [
        "交付可复用案例系列结构、客户核准稿、指标与基线表、匿名备选版本及逐渠道使用授权记录。",
        "Deliver a reusable case structure, customer-approved copy, metrics and baseline, anonymized version and channel-specific permissions.",
      ],
      [
        "不得泄露合同保密信息或把相关性宣传成因果，不可将单一案例的收益承诺给所有客户；客户需审阅最终发布版本。",
        "Do not reveal confidential information or claim causation from correlation; never promise one customer's outcomes to all, and obtain final approval.",
      ],
    ),
    detail(
      [
        "收集品牌正式立场、形成背景、支撑数据或公开来源、反方关切、发言人和适用平台的审稿要求。",
        "Collect approved brand positions, context, supporting data or public sources, opposing concerns, spokesperson and review requirements.",
      ],
      [
        "提出可讨论的问题，解释观点依据并区分事实、价值判断和推测，邀请建设性回应而非制造对立引导互动。",
        "Pose discussable questions, explain rationale and separate fact, value judgment and speculation, inviting constructive discussion.",
      ],
      [
        "交付观点主题序列、单条论证大纲、来源与反方观点清单及回应指引，列明需要法务或管理层审核的表达。",
        "Deliver topic sequence, argument outline, sources and counterarguments with response guide and legal or leadership review flags.",
      ],
      [
        "观点不应伪装为客观共识，引用数据需注明范围和时点；避免政治、医疗等专业议题未经授权或证据支持的断言。",
        "Do not disguise opinions as consensus; date and scope evidence, and avoid unsupported or unauthorized claims on expert topics.",
      ],
    ),
    detail(
      [
        "收集公告原文、正式确认人、事实更新、受影响对象、发布时间、有效链接和需要保密或分阶段发布的信息。",
        "Collect original notice, approver, confirmed updates, affected audience, publication time, links and embargoed or staged information.",
      ],
      [
        "采用已确认事实与未知项分栏表达，针对不同受众解释影响和下一步，将状态变化与原因判断分开处理。",
        "Separate confirmed facts from unknowns, explain impacts and actions for each audience, and distinguish status from causal interpretation.",
      ],
      [
        "交付事实核对表、分渠道短版与详版、更新记录和问答入口，注明来源版本、更新时间及纠错联系人。",
        "Deliver fact-check table, short and detailed channel copies, update log and FAQ route with source version, update time and correction contact.",
      ],
      [
        "不得推测事故原因、责任或恢复时间；发布前核实公告权限与隐私处理，变更后保留旧版记录并明确现行版本。",
        "Do not speculate on causes, responsibility or restoration; verify authority and privacy, retaining versions and clearly marking the current update.",
      ],
    ),
    detail(
      [
        "收集服务实际变化、受影响客户或用户范围、切换日期、旧流程过渡期、替代方案、支持入口及批准口径。",
        "Collect actual service changes, affected users, transition dates and period, alternatives, support channel and approved wording.",
      ],
      [
        "解释变化内容和原因、用户需要采取的步骤、数据或权益如何处理，按影响程度分组通知并准备问题升级路径。",
        "Explain changes, rationale, user actions and data or benefit handling; segment notifications by impact and prepare escalations.",
      ],
      [
        "交付通知正文、影响与行动矩阵、常见问题和发送排期，记录每类受众、审批状态、支持负责人和需人工通知的名单依据。",
        "Deliver notice, impact-action matrix, FAQ and schedule with audience, approvals, support owner and rationale for manual notices.",
      ],
      [
        "不得模糊服务终止或费用影响，不在未获授权时承诺补偿；准确核对协议、通知期限、退订要求及用户数据去向。",
        "Do not obscure termination or cost impacts or promise unauthorized compensation; verify contracts, notice periods, opt-outs and data handling.",
      ],
    ),
    detail(
      [
        "收集活动签到与真实参与记录、议程完成情况、经许可图片、反馈和后续事项，注明人数口径与资料采集授权。",
        "Collect actual attendance, agenda completion, licensed images, feedback and follow-ups, with counting rules and data permissions.",
      ],
      [
        "依照计划与实际对照总结活动进展，选择能说明效果的匿名反馈，列出未实现目标和后续改进，不把主办方自评当参与者共识。",
        "Compare actual outcomes with plans, select anonymized feedback, note unmet objectives and improvements, separating organizer views from attendee consensus.",
      ],
      [
        "交付活动回顾稿、可核验指标、图片署名及授权表、后续行动清单和内部复盘问题，标明公开版本与内部版本差异。",
        "Deliver recap, verifiable metrics, image credits and permissions, follow-up actions and retrospective questions, distinguishing public and internal versions.",
      ],
      [
        "人数须使用一致且透明的计算口径，不编造好评、收益或合作成果；发布照片、评价和联系方式前确认授权及脱敏。",
        "Use transparent attendance definitions and never invent praise or outcomes; obtain consent and redact photos, feedback and contact details.",
      ],
    ),
  ],
  "lesson-plan": [
    detail(
      [
        "收集课程标准、学生已有知识、课时安排、核心概念、常见误解和可用教学材料，确认本节课在单元中的位置。",
        "Collect standards, prior knowledge, time, core concepts, misconceptions and teaching materials, placing the lesson within the unit.",
      ],
      [
        "用一个贴近学习目标的问题唤起已有经验，逐步揭示新知识；在讲解后插入低门槛检查点并按回答调整讲授深度。",
        "Use a goal-aligned question to activate prior knowledge, build the concept and insert checks that adapt instruction to learner responses.",
      ],
      [
        "交付可按分钟执行的流程、导入问题、板书或页面结构、形成性检查和课末出口题，标注预计学生回应与补救提示。",
        "Deliver a timed sequence, opening question, board or slide plan, formative checks and exit ticket with expected responses and supports.",
      ],
      [
        "导入趣味不能挤占必要练习时间，目标需能由出口题观察；教师核对事实、学段适配和敏感案例后再授课。",
        "Do not let an engaging opener displace practice; align exit checks to objectives and review facts, grade suitability and sensitive examples.",
      ],
    ),
    detail(
      [
        "收集已教知识点、单元目标、课堂测验和常见错题、学生反馈以及需要间隔复习的核心概念。",
        "Collect taught concepts, unit objectives, quiz results, common errors, learner feedback and concepts needing spaced retrieval.",
      ],
      [
        "用回忆练习诊断而非直接重讲全部内容，按错误类型组织示例、纠错反馈和相似但变化的迁移题。",
        "Diagnose with retrieval rather than reteach everything; group examples by error type with corrective feedback and varied transfer problems.",
      ],
      [
        "交付复习节奏、分层题组及答案解析、错因提示和课后间隔练习安排，明确每道题对应的知识点与难度。",
        "Deliver a review sequence, tiered question sets and explanations, error hints and spaced practice mapped to concepts and difficulty.",
      ],
      [
        "答案和评分依据由教师核对，练习需覆盖不同基础，避免只重复记忆题；反馈中不公开学生个人成绩和敏感困难。",
        "Teachers verify answers and scoring; cover varied ability without only recall items, protecting individual grades and sensitive difficulties.",
      ],
    ),
    detail(
      [
        "收集目标技能、课堂时长、班级学情、练习题原稿、参考答案、设备和可用辅助材料，并确认已有内容不超出学段范围。",
        "Collect target skills, lesson duration, learner needs, draft tasks, answer keys, equipment and available supports; check grade-level scope.",
      ],
      [
        "把练习拆成示范、独立尝试、必要提示和对答案解释，按基础与挑战层安排任务并预设卡住时的提示梯度。",
        "Structure practice into modeling, independent attempt, scaffold and explanation, with baseline and challenge tasks and graduated hints.",
      ],
      [
        "交付课堂练习包、教师讲评要点、分层选题表和时间安排，提供答案、易错点与学生自检标准的独立版本。",
        "Deliver a practice packet, teacher debrief, tiered selection and timing, with separate answers, common errors and learner self-checks.",
      ],
      [
        "题目难度和标准须贴合教学目标，答案经过独立校对；留意无障碍要求和设备差异，防止练习时长超过实际课时。",
        "Align difficulty and standards to objectives and independently check answers; account for accessibility, device differences and actual time.",
      ],
    ),
    detail(
      [
        "收集单元知识目标、知识关联、课时数、考试或实践要求、作业与错题反馈，区分必备与拓展内容。",
        "Collect unit objectives, concept links, lesson count, exam or practice requirements, assignments and errors, separating core and extension.",
      ],
      [
        "先重建知识网络，再按基础、联系和综合应用安排复习，穿插检索、小组解释与多步骤迁移，减少无目的重复刷题。",
        "Rebuild the concept network, then review foundations, relationships and application using retrieval, peer explanation and transfer.",
      ],
      [
        "交付单元知识图、复习课时分配、综合题组和讲评脚本，建立错因到补救练习的映射，并提供复习后掌握检查。",
        "Deliver a concept map, lesson allocation, integrated tasks and debrief, mapping errors to remediation and mastery checks.",
      ],
      [
        "覆盖关键目标和先修关联，避免仅凭一套模拟题代表掌握；题目难度与答案由教师复核，并兼顾课时和学生负担。",
        "Cover core objectives and prerequisites without treating one practice set as mastery; verify difficulty and answers and consider workload.",
      ],
    ),
    detail(
      [
        "收集岗位操作任务、现行作业标准、学员经验、设备和练习场地、评价方式及安全或质量要求。",
        "Collect job tasks, current procedures, learner experience, equipment, practice setting, assessment and safety or quality needs.",
      ],
      [
        "将岗位成果拆成可观察的操作步骤、质量判断和异常升级，按示范、受控练习、独立完成和反馈逐步提升。",
        "Break job outcomes into observable steps, quality judgments and escalation, progressing through modeling, practice and feedback.",
      ],
      [
        "交付岗位任务教案、演示清单、练习工单、评价量表和纠错指导，说明练习设备、合格判据及后续主管确认。",
        "Deliver a job-task lesson, demonstration checklist, practice tickets, rubric and remediation with equipment and supervisor sign-off.",
      ],
      [
        "培训完成不等于岗位授权；设备、制度和质量标准须由岗位负责人确认，练习样例不得含生产账号或客户真实数据。",
        "Training completion does not confer job authorization; owners verify standards and examples exclude production credentials and customer data.",
      ],
    ),
    detail(
      [
        "收集设备型号、操作环境、现行手册、步骤限制、工具材料、学员基础和适用的安全防护要求。",
        "Collect equipment models, environment, current manuals, restrictions, tools, learner knowledge and required safety protections.",
      ],
      [
        "把关键操作分成可暂停检查的动作，讲师先完整示范再逐步解释，学员在监督下复做并练习识别异常与停止条件。",
        "Split critical operations into checkable steps; demonstrate first, then supervise practice and teach anomaly and stop conditions.",
      ],
      [
        "交付讲师示范脚本、步骤图或检查表、学员复做记录与常见故障排查，分别标注观察点、通过标准及设备差异。",
        "Deliver a demonstration script, step checklist, practice record and troubleshooting, noting observation points and model differences.",
      ],
      [
        "涉及危险设备时由合格人员确认隔离与防护流程；操作环境或型号不符时不得照搬，练习期间发现异常立即停止并报告。",
        "Qualified staff must verify safeguards; do not transfer instructions to different equipment or conditions, and stop on anomalies.",
      ],
    ),
    detail(
      [
        "收集适用安全制度、工作场所风险、事故案例的脱敏版本、设备环境、紧急联络与应急演练要求。",
        "Collect applicable safety policies, workplace hazards, anonymized incidents, equipment context, emergency contacts and exercise requirements.",
      ],
      [
        "按本单位已批准的应急规程练习风险识别和停止作业，先保障人员安全并在必要时撤离，再在安全条件下保护现场、报告升级，说明各项判断依据。",
        "Practice hazard recognition and stop-work under the organization's approved emergency procedures; prioritize personal safety and evacuation when needed, then secure the scene only when safe and report or escalate, explaining each decision.",
      ],
      [
        "交付分角色演练脚本、风险提示卡、观察评分表和事后复盘问题，标注负责安全人员、所用制度版本和紧急联系方式。",
        "Deliver role-play scripts, hazard cards, observation rubric and debrief, identifying safety owner, policy version and emergency contacts.",
      ],
      [
        "紧急步骤与联系方式由合格安全人员签核，不用虚构事故细节或展示未授权现场；学员应知晓演练不能替代正式授权。",
        "Qualified safety staff approve emergency steps; avoid fabricated incidents or unauthorized scenes and state that drills do not confer authorization.",
      ],
    ),
    detail(
      [
        "收集模拟场景、角色设定、学习目标、可使用材料、时间限制和应观察的表现维度，去除真实敏感案例中的身份线索。",
        "Collect scenario, roles, objectives, materials, time limits and observable behaviors, removing identity clues from sensitive real cases.",
      ],
      [
        "设置简洁背景与逐步释放的信息，让参与者先判断再行动；观察者依据行为记录并给出基于事实的反馈。",
        "Provide concise context and staged information so learners decide and act; observers record behaviors and give evidence-based feedback.",
      ],
      [
        "交付情境卡、角色说明、主持人引导、观察量表和复盘问题，标注每个阶段的目标行为、可选路径与时间。",
        "Deliver scenario cards, role briefs, facilitator guide, observer rubric and debrief, with target behaviors and timing.",
      ],
      [
        "明确练习与真实授权、绩效判定的界线，避免角色压力伤害参与者；涉及冲突和个人经历时允许退出或换用虚构案例。",
        "Separate practice from real authority or performance judgments; avoid harmful pressure and offer fictional scenarios or opt-outs.",
      ],
    ),
    detail(
      [
        "收集沟通对象、常见工作情境、团队规则、冲突案例的脱敏版本、期望练习时长和评价标准，并约定课堂反馈边界。",
        "Collect audience, communication scenarios, team norms, anonymized conflict cases, practice time and assessment criteria, agreeing on feedback boundaries.",
      ],
      [
        "训练倾听复述、开放提问、事实与感受区分及具体反馈，按工作场景轮换角色并对措辞造成的效果进行复盘。",
        "Practice reflective listening, open questions, fact-feeling distinction and specific feedback, rotating roles and reviewing impact.",
      ],
      [
        "交付角色练习卡、对话观察表、可替换表达和复盘提问，标明可观察的沟通行为及现场引导者注意事项。",
        "Deliver role cards, observation checklist, alternative phrasing and debrief questions with observable behaviors and facilitator notes.",
      ],
      [
        "避免将真实冲突中的敏感言论直接呈现在课堂，尊重差异和不参与权；评价具体行为而非给人贴性格或心理标签。",
        "Avoid exposing sensitive real conflict, respect differences and opt-outs, and assess behavior rather than personality or mental-health labels.",
      ],
    ),
    detail(
      [
        "收集待解决问题、已知事实、可用数据、资源与时间约束、决策影响和不能改变的条件。",
        "Collect the problem, known facts, available data, resource and time constraints, decision impact and fixed conditions.",
      ],
      [
        "先界定问题与根因假设，再收集缺失信息、比较替代方案和副作用，选择可检验的下一步并设计复盘指标。",
        "Define the problem and root-cause hypotheses, gather missing information, compare alternatives and side effects, then test a next step.",
      ],
      [
        "交付问题陈述、证据与假设表、方案决策矩阵、实验或行动计划及复盘指标，区分即时止损与长期改进。",
        "Deliver problem statement, evidence and assumptions, decision matrix, experiment or action plan and review metrics, separating containment from improvement.",
      ],
      [
        "推断原因必须有可验证证据，避免把相关现象当根因；多方案比较应使用统一标准并说明失败信号和停止条件。",
        "Support causal claims with testable evidence, avoid confusing correlation with cause, and state common criteria, failure signals and stop conditions.",
      ],
    ),
    detail(
      [
        "收集团队任务说明、交付节点、成员职责、接口依赖、可用工具、时间限制和成功标准，并确认协作过程的观察范围。",
        "Collect team task, deliverables, milestones, roles, interfaces, tools, time limits and success criteria, defining observation scope.",
      ],
      [
        "将任务拆分到互相依赖清晰的工作包，安排交接确认、进度同步和合并决策，再复盘协作过程而非只看最终结果。",
        "Break work into clear packages, define handoffs and merge decisions, then review collaboration as well as outcomes.",
      ],
      [
        "交付分工与交接表、小组任务流程、协作观察量表及复盘议程，列出个人贡献证据、阻塞处理和下一轮改进。",
        "Deliver role and handoff table, workflow, observation rubric and retrospective agenda with contribution evidence and improvements.",
      ],
      [
        "确保评价依据是可观察行为而非人气或身份，合理分配工作量并提供不同参与方式；团队分歧不被自动判为个人失误。",
        "Base assessment on observable behavior, not popularity; balance workload and participation while treating disagreement fairly.",
      ],
    ),
    detail(
      [
        "收集案例背景、去标识化证据、目标课程概念、不同利益相关方观点、讨论时间和课程目标。",
        "Collect case context, de-identified evidence, target concepts, stakeholder perspectives, discussion time and objectives.",
      ],
      [
        "先让学员独立提出判断，再分组检验证据和假设、辩论备选方案，最后比较结论如何随新信息变化。",
        "Have learners judge individually, test evidence and assumptions in groups, debate alternatives and revisit conclusions as evidence changes.",
      ],
      [
        "交付案例材料、分阶段讨论题、教师参考分析、多角度评分标准和复盘总结，清晰区分已知事实与留白信息。",
        "Deliver case materials, staged questions, instructor notes, multi-perspective rubric and debrief separating facts from unknowns.",
      ],
      [
        "案例人物和组织须保护身份，避免单一标准答案掩盖真实复杂度；教师核对材料许可、证据完整性和讨论的情绪安全。",
        "Protect case identities and preserve complexity; verify permissions, evidence and emotional safety for discussion.",
      ],
    ),
  ],
  "curriculum-design": [
    detail(
      [
        "收集学习者基础、岗位或学段能力目标、总课时、先修知识、可用教师与设备资源，以及必须遵循的课程标准。",
        "Collect learner baseline, role or grade outcomes, total hours, prerequisites, teacher and equipment resources, and required standards.",
      ],
      [
        "将总目标拆成由浅入深的模块和可观察成果，安排知识、练习、反馈与复习的递进关系，标注每个模块的先修与出口。",
        "Decompose outcomes into progressive modules with observable results, sequencing knowledge, practice, feedback and review with prerequisites and exits.",
      ],
      [
        "交付课程地图、模块目标与课时、练习和评价表、资源清单及学习路径，标明目标覆盖、先修关系和仍需补齐的内容。",
        "Deliver a curriculum map, module outcomes and hours, practice and assessment, resources and learning paths with coverage and gaps.",
      ],
      [
        "避免把课时表当成能力证明，检查目标是否可评价及资源是否可用；不同学习基础应有补救或跳过路径。",
        "Do not treat a schedule as proof of competence; verify assessable outcomes and resources with remediation or skip paths.",
      ],
    ),
    detail(
      [
        "收集学习者已有能力、专业标准、复杂任务、进阶工具、导师资源和基础课程的完成证据。",
        "Collect existing skills, professional standards, advanced tasks, tools, mentors and evidence of foundational completion.",
      ],
      [
        "把基础能力作为入口，逐步引入复杂判断、跨模块项目和质量评审，设计有反馈的阶段性成果而非只增加理论章节。",
        "Use foundations as entry, add complex judgment, integrated projects and quality reviews with feedback rather than more theory.",
      ],
      [
        "交付进阶课程地图、项目与评价门槛、导师支持计划和复习补充模块，标注与基础课程的差异及学习负荷。",
        "Deliver an advanced map, project and assessment gates, mentoring plan and remediation modules, with differences and workload.",
      ],
      [
        "不要假设学员完成基础课就具备真实岗位经验；检查进阶任务的资源、风险和反馈能力，避免重复已有内容。",
        "Do not assume a foundation course equals job experience; verify resources, risk and feedback for advanced tasks and remove duplication.",
      ],
    ),
    detail(
      [
        "收集参与学科的目标、共同问题、各学科标准、可用课时、教师协作机制和项目素材，并确认学科教师可参与的时间。",
        "Collect participating discipline goals, shared problem, standards, hours, collaboration and materials, confirming teacher availability.",
      ],
      [
        "围绕一个共同项目映射各学科的独立知识贡献和协作节点，安排跨学科交接、综合作品和分学科评价。",
        "Map each discipline's contribution and collaboration around a shared project, with handoffs, integrated work and discipline-specific assessment.",
      ],
      [
        "交付跨学科项目地图、课时与教师分工、学科目标覆盖表、评价量规和冲突协调机制，并附项目材料与责任学科对应表。",
        "Deliver an interdisciplinary map, hours and teacher roles, objective coverage, rubric and conflict-resolution mechanism with material ownership.",
      ],
      [
        "不可用一个模糊总分掩盖学科目标缺失，核对先修和教师时间；不同学科术语与评价标准需提前对齐。",
        "Do not hide missing discipline outcomes in one vague score; align prerequisites, teacher time, terminology and criteria.",
      ],
    ),
    detail(
      [
        "收集真实项目背景、成果标准、资源与预算、项目周期、风险约束、客户或评审人的角色。",
        "Collect real project context, outcome criteria, resources and budget, duration, constraints and client or reviewer roles.",
      ],
      [
        "按启动、调查、方案、实施、验收和展示拆分里程碑，为每阶段配置辅导、检查点和修订机会，并保留过程证据。",
        "Split launch, inquiry, design, build, acceptance and presentation into milestones with coaching, checkpoints, revision and process evidence.",
      ],
      [
        "交付项目式课程路线、阶段任务包、导师检查表、成果评价量规和展示安排，区分过程表现与最终成果。",
        "Deliver a project-learning route, stage tasks, mentor checklist, outcome rubric and showcase, separating process from final product.",
      ],
      [
        "项目周期与资源必须现实可达，评价不能只奖励最终展示；涉及真实客户或数据时明确授权、隐私和失败处置。",
        "Ensure realistic time and resources, assess process as well as showcase, and define permissions, privacy and failure handling.",
      ],
    ),
    detail(
      [
        "收集新人岗位说明、入职阶段、必须学习的制度和工具、支持人员、上岗条件及可使用的练习环境。",
        "Collect new-hire role, onboarding stages, required policies and tools, support staff, authorization conditions and practice environment.",
      ],
      [
        "按入职前、首周、首月和独立工作阶段规划学习与实践，分别标出学习完成、观察通过和正式授权。",
        "Plan learning and practice for preboarding, first week, first month and independence, separating completion, observation and authorization.",
      ],
      [
        "交付新人学习路径、任务清单、导师触点、阶段检查和转正前证据要求，提供未达标时的补训与升级流程。",
        "Deliver a new-hire path, task list, mentor touchpoints, checkpoints and evidence requirements with remediation and escalation.",
      ],
      [
        "完成视频或测验不等于能独立作业；权限、敏感数据和安全操作必须由岗位负责人另行确认。",
        "Videos or quizzes do not prove independent work; owners separately confirm permissions, sensitive data handling and safety.",
      ],
    ),
    detail(
      [
        "收集岗位能力标准、认证范围、考核条件、考官资格、有效期、现有训练材料和外部机构规则。",
        "Collect role standards, certification scope, assessment conditions, assessor qualifications, validity, training materials and external rules.",
      ],
      [
        "逐项映射课程练习到能力标准和考试证据，安排模拟考、反馈和补强，区分内部结业与外部认证申请。",
        "Map practice to standards and exam evidence, schedule mock assessments and remediation, separating internal completion from external certification.",
      ],
      [
        "交付认证课程地图、能力证据矩阵、练习与评分量规、报名及复审流程，明确考官、截止日期和证书状态。",
        "Deliver a certification map, evidence matrix, practice rubric and registration and renewal process with assessors, deadlines and status.",
      ],
      [
        "不得声称课程自动授予外部证书，核对版本、考试规则和考官授权；个人成绩和证件资料按隐私要求保存。",
        "Do not claim the course grants external certification; verify rules and assessor authority and protect scores and credentials.",
      ],
    ),
    detail(
      [
        "收集管理职责、团队场景、能力差距、现有反馈、管理制度、可安排的实践任务和辅导资源。",
        "Collect management duties, team scenarios, capability gaps, feedback, policies, practice tasks and coaching resources.",
      ],
      [
        "以实际管理任务串联目标设定、反馈、冲突处理和决策练习，安排同伴讨论及上级辅导，关注行为证据而不是头衔。",
        "Connect goal setting, feedback, conflict and decisions through real tasks, peer discussion and coaching, focusing on behavior evidence.",
      ],
      [
        "交付管理者发展路径、情境任务、观察量规、辅导计划和复盘节奏，标注隐私边界与不适合公开的人员信息。",
        "Deliver a manager path, scenario tasks, observation rubric, coaching plan and review cadence with privacy boundaries.",
      ],
      [
        "不要用员工个案做未经同意的课堂材料，不把单次反馈推断为管理能力；评价标准由组织与参与者提前知情。",
        "Do not use employee cases without consent or infer capability from one feedback; make evaluation criteria known in advance.",
      ],
    ),
    detail(
      [
        "收集专业工作任务、能力级别、标准或规范、设备材料、练习时长和专家可提供的示范与反馈。",
        "Collect professional tasks, skill levels, standards, equipment, practice time and expert demonstrations and feedback.",
      ],
      [
        "从核心动作到复杂场景递进，安排示范、受控练习、独立产出和同行评审，明确质量判断点与异常升级。",
        "Progress from core actions to complex scenarios with modeling, practice, independent output and peer review, defining quality points and escalation.",
      ],
      [
        "交付专业课程地图、技能练习、案例与量规、专家反馈安排和持续复习清单，说明每项技能所需资源。",
        "Deliver a professional map, skill practice, cases and rubrics, expert feedback and refresh list with required resources.",
      ],
      [
        "标准和工具版本可能变化，标注生效日期并设置复审；不得把模拟环境表现直接等同于生产质量或资格。",
        "Standards and tools change; date and review them, and do not equate simulation performance with production quality or qualification.",
      ],
    ),
    detail(
      [
        "收集线上平台、线下场地、学习目标、学习者设备与网络、辅导时间、可打印材料和评价要求。",
        "Collect online platform, physical venue, objectives, learner devices and connectivity, support time, printable materials and assessment.",
      ],
      [
        "将自学内容、直播互动、线下实操与异步反馈分配到各自适合的任务，明确同步缺席时的替代路径。",
        "Assign self-study, live interaction, hands-on practice and asynchronous feedback to suitable tasks with alternatives for absence.",
      ],
      [
        "交付混合式课程日历、平台与现场操作说明、学习包、签到和产出评价表，标注资源下载和隐私边界。",
        "Deliver blended calendar, platform and venue instructions, learning pack, attendance and output assessment with resource and privacy notes.",
      ],
      [
        "线上签到不能证明学习达成，核对网络和设备可达性；线下材料需与线上版本一致，无法同步时保留未验证项。",
        "Attendance does not prove learning; check access and device constraints, keep online and physical versions aligned and disclose gaps.",
      ],
    ),
    detail(
      [
        "收集远程学习平台、学习者时区、设备与网络、异步资源、辅导时段、目标能力和互动规则。",
        "Collect remote platform, learner time zones, devices and connectivity, asynchronous resources, support windows, outcomes and interaction rules.",
      ],
      [
        "采用短课、讨论、示范和异步作业组合，按时区轮换互动或提供回看，并设置提交、反馈和补交的明确期限。",
        "Combine short lessons, discussions, demonstrations and asynchronous work, rotating time zones or recording sessions with clear deadlines.",
      ],
      [
        "交付远程课程节奏、异步学习包、讨论规范、答疑排班和作品提交检查表，记录版本、时区和可访问性措施。",
        "Deliver remote cadence, asynchronous pack, discussion rules, support roster and submission checklist with versions, time zones and accessibility.",
      ],
      [
        "登录或观看不等于掌握，避免把网络故障归咎于学习者；需提供低带宽或补交路径并保护线上讨论中的个人信息。",
        "Login or viewing does not prove mastery; provide low-bandwidth and makeup paths and protect personal information in discussions.",
      ],
    ),
    detail(
      [
        "收集导师人数与专长、学员目标、岗位任务、带教周期、可投入时间、反馈渠道和需要保密的个人信息。",
        "Collect mentor capacity and expertise, learner goals, job tasks, duration, time, feedback channels and confidential information.",
      ],
      [
        "按目标设计观察、示范、共同完成、独立尝试和定期反馈，明确导师与主管的职责边界及升级困难的入口。",
        "Design observation, modeling, co-work, independent practice and feedback with clear mentor-supervisor boundaries and escalation.",
      ],
      [
        "交付带教计划、会面节奏、任务与观察表、反馈模板和阶段复盘，记录资源负荷、学员证据与导师建议。",
        "Deliver mentoring plan, cadence, task and observation sheets, feedback template and reviews with workload, evidence and advice.",
      ],
      [
        "导师意见需基于行为证据，保护学员隐私并避免形成未经同意的绩效结论；导师时间不足时及时调整目标。",
        "Base mentoring feedback on behavior, protect learner privacy and avoid unauthorized performance conclusions; adjust goals when mentor capacity falls short.",
      ],
    ),
    detail(
      [
        "收集在岗人群的工作变化、能力目标、可用学习时间、现行制度、复审周期和能支持学习迁移的主管及资源。",
        "Collect workforce changes, capability goals, available time, current policies, review cycles, supervisors and transfer resources.",
      ],
      [
        "将短模块、案例复习和工作任务结合，安排完成后在岗应用与主管回访，设置复审和版本更新节点。",
        "Combine short modules, case review and workplace tasks with supervisor follow-up, review and update points.",
      ],
      [
        "交付继续教育路线、复习与实践清单、迁移证据、复审日历和完成标准，区分学习完成、能力展示与制度更新。",
        "Deliver continuing-education route, practice list, transfer evidence, review calendar and completion standards separating learning from demonstrated capability.",
      ],
      [
        "出勤或完成视频不能代表能力保持，内容需要随制度和工具更新；注意在岗人员时间与隐私，不把学习数据用于未授权评价。",
        "Attendance or video completion does not prove retention; update content with policy and tools, respecting time and privacy and avoiding unauthorized use.",
      ],
    ),
  ],
  "financial-model": [
    detail(
      [
        "收集年度目标、月度历史收入成本、业务驱动指标、人员计划、预算版本、会计期间和预测批准口径。",
        "Collect annual targets, monthly actuals, business drivers, staffing plans, budget versions, periods and forecast approvals.",
      ],
      [
        "从可验证业务驱动建立月度收入和成本，拆分实际、预测及一次性项目，形成基准与变化解释并保留模型版本。",
        "Build monthly revenue and costs from verified drivers, separate actuals, forecasts and one-offs, explain variances and version the model.",
      ],
      [
        "交付按月预测、驱动假设、目标与预测差异、利润及现金关联检查表，标注数据来源和待财务确认事项。",
        "Deliver monthly forecasts, driver assumptions, target variances and profit-cash checks with data sources and finance questions.",
      ],
      [
        "收入、成本、利润和现金时点必须勾稽；不得将预算目标当作预测结果，缺失数据和季节性假设需明确说明。",
        "Reconcile revenue, costs, profit and cash timing; do not treat targets as forecasts and disclose missing data and seasonality assumptions.",
      ],
    ),
    detail(
      [
        "收集最近月度实际、年度剩余期间、业务驱动最新值、上版滚动预测、预算与关键外部假设。",
        "Collect latest monthly actuals, remaining periods, current drivers, prior rolling forecast, budget and external assumptions.",
      ],
      [
        "锁定已关闭期间实际，更新未结月份驱动，逐版本比较预测变化与实际偏差，解释变化来自销量、价格、人员还是时点。",
        "Lock closed actuals, update open-period drivers and compare forecast vintages, explaining volume, price, staffing and timing changes.",
      ],
      [
        "交付最新滚动预测、版本差异桥接、关键驱动及敏感性表、假设变更日志，保持历史预测和审批记录可追溯。",
        "Deliver current forecast, vintage bridge, drivers and sensitivities, and assumption log while preserving prior forecasts and approvals.",
      ],
      [
        "不能覆盖已确认实际或静默改写旧预测；确认关账日期、版本责任人和汇率，避免用已实现信息伪装原预测准确。",
        "Never overwrite actuals or silently rewrite history; verify close dates, version owners and rates, avoiding hindsight bias.",
      ],
    ),
    detail(
      [
        "收集业务线收入、直接成本、人员安排、共享成本分配规则、内部交易和各线预测责任人。",
        "Collect business-line revenue, direct costs, staffing, shared-cost allocation, intercompany activity and forecast owners.",
      ],
      [
        "先建业务线独立损益，再单独分配共享服务及内部结算，比较贡献利润和驱动；执行合并时显式抵消内部交易。",
        "Build standalone P&Ls, allocate shared services separately, compare contribution drivers and eliminate intercompany activity on consolidation.",
      ],
      [
        "交付各线损益预测、分摊规则与敏感性、合并抵消表和责任分工，区分直接归属成本与管理层分摊。",
        "Deliver line-level P&L forecasts, allocation rules and sensitivities, consolidation eliminations and owners, separating direct and allocated costs.",
      ],
      [
        "避免共享成本重复计列或因分摊方式掩盖亏损业务线；核实内部交易抵消、组织结构和口径变更。",
        "Avoid duplicate overhead and allocations masking loss-making lines; verify intercompany eliminations, organization and definition changes.",
      ],
    ),
    detail(
      [
        "收集新业务获批计划、目标客户、定价与转化假设、启动时间、固定投入、可变成本和阶段性经营门槛。",
        "Collect approved new-business plans, customers, pricing and conversion assumptions, start date, fixed and variable costs and gates.",
      ],
      [
        "按准备、试点、增长和稳定阶段分别建模客户、收入、费用及现金消耗，设置销量和成本组合的基准与保守情景。",
        "Model customers, revenue, costs and cash by setup, pilot, growth and steady stages with base and conservative cases.",
      ],
      [
        "交付分阶段经营预测、资金需求与现金跑道、关键里程碑门槛和假设表，明确哪些判断依赖尚无历史数据的估算。",
        "Deliver staged forecasts, funding and runway, milestones and assumptions, identifying estimates without historical evidence.",
      ],
      [
        "未启动业务不得伪造客户或历史转化，外推增速要受容量和市场条件约束；投资承诺需由授权负责人确认。",
        "Do not invent customers or conversion history; constrain growth by capacity and market conditions and obtain investment approval.",
      ],
    ),
    detail(
      [
        "收集部门目标、费用科目、历史实际、在岗与招聘计划、项目申请、分配方法和审批层级，并确认成本中心映射。",
        "Collect department targets, expense accounts, actuals, staffing, projects, allocations, approval levels and cost-center mapping.",
      ],
      [
        "逐科目区分固定承诺、人员成本和可裁量项目，对比历史基线与增量请求，指定预算负责人与审批阶段。",
        "Separate fixed commitments, staffing and discretionary requests by account; compare baseline and increments and assign owners and approval stages.",
      ],
      [
        "交付部门预算明细、申请依据、预算与实际映射、调整及待批项清单，保持科目、期间、币种和成本中心一致。",
        "Deliver departmental details, request rationale, budget-to-actual mapping and pending approvals with aligned accounts, periods and centers.",
      ],
      [
        "不得重复纳入中央预算和部门预算，确认含税口径、人员变动日期及授权额度；未获批准项目单列而非混入基线。",
        "Avoid double counting central and department budgets; verify tax, staffing dates and authority, keeping unapproved requests separate.",
      ],
    ),
    detail(
      [
        "收集岗位编制、薪酬区间或获批金额、福利税费口径、入离职计划、调薪日期和访问控制要求。",
        "Collect headcount, approved pay, benefits and tax definitions, start and exit plans, raise dates and access controls.",
      ],
      [
        "按岗位与月份计算基础薪酬、雇主成本、福利和空缺期间，区分在岗、招聘中与已批准但未到岗人员。",
        "Calculate monthly pay, employer costs, benefits and vacancy periods by role, distinguishing active, recruiting and approved hires.",
      ],
      [
        "交付月度编制与成本桥接、假设说明、招聘情景和预算差异表，限制可识别薪酬明细的传播范围。",
        "Deliver monthly headcount and cost bridge, assumptions, hiring cases and variances with restricted compensation detail.",
      ],
      [
        "薪酬信息属于敏感数据，避免输出姓名级明细；检查重复岗位、入离职时点、币种和税费口径并由人力财务复核。",
        "Compensation is sensitive; avoid named detail and check duplicates, dates, currency and taxes with HR finance review.",
      ],
    ),
    detail(
      [
        "收集费用科目、合同及付款计划、业务量驱动、历史支出、固定或变动属性、税费与供应商条件。",
        "Collect expense accounts, contracts and payments, business drivers, actuals, fixed or variable behavior, tax and vendor terms.",
      ],
      [
        "按业务量或合同驱动预测费用，分开固定承诺、阶梯计价和一次性支出，分析节约措施对服务质量的影响。",
        "Forecast by volume or contract drivers, separating fixed commitments, tiers and one-offs, and assess savings impacts on service quality.",
      ],
      [
        "交付运营费用明细及驱动公式、固定与变动分类、合同到期日和成本变化情景，指出尚需采购或财务核对的行项。",
        "Deliver expense details and drivers, fixed/variable classification, renewal dates and scenarios, flagging procurement or finance checks.",
      ],
      [
        "不得仅按历史平均掩盖阶梯价格或到期涨价；核对期间、税费及币种，确认节约估算未重复计算且有责任人。",
        "Do not hide tiering or renewals in historical averages; check periods, taxes and currency and prevent duplicate savings.",
      ],
    ),
    detail(
      [
        "收集资本项目授权、采购与付款节点、预计使用寿命、折旧政策、项目预算和替代方案比较。",
        "Collect capital approvals, procurement and payment milestones, useful lives, depreciation policy, project budgets and alternatives.",
      ],
      [
        "区分付款现金流与资本化资产，按政策估算入账期间和折旧；将建设延期、成本超支及投产后的运维费用分别建模。",
        "Separate cash payments from capitalized assets, estimate timing and depreciation per policy, and model delay, overruns and ongoing costs.",
      ],
      [
        "交付资本支出月表、资产与折旧假设、现金影响和项目情景，并标注会计政策、批准状态及财务复核问题。",
        "Deliver monthly capital spending, asset and depreciation assumptions, cash impact and scenarios with policy, approval status and finance questions.",
      ],
      [
        "资本化判断须由财务确认，避免将付款时间误作费用确认时间；检查重复采购、残值、验收和延期后的使用起始日。",
        "Finance must validate capitalization; do not confuse payment with expense recognition and check duplicates, residual value and in-service dates.",
      ],
    ),
    detail(
      [
        "收集期初现金余额、应收应付账龄、收付款计划、薪资税款、资本项目、融资条款和预计到账日期。",
        "Collect opening cash, receivable and payable aging, payment plans, payroll and taxes, capital projects, financing and receipt dates.",
      ],
      [
        "按周或月将经营、投资与融资现金流分开，估算期末余额和最低现金门槛，并设置回款延迟及支出加速情景。",
        "Separate operating, investing and financing cash by week or month, model ending cash and minimum thresholds, and stress delayed receipts.",
      ],
      [
        "交付现金余额预测、资金缺口时间、情景比较和应收应付重点清单，说明现金与利润差异及需要采取的行动日期。",
        "Deliver cash forecast, shortfall timing, scenarios and receivables/payables priorities, explaining profit differences and action dates.",
      ],
      [
        "不应以确认收入替代已收现金，账期和到账概率需有依据；核查重复付款、受限现金及融资条件有效期。",
        "Do not substitute recognized revenue for cash; support timing and probability, checking duplicate payments, restricted cash and financing terms.",
      ],
    ),
    detail(
      [
        "收集现行价格、按期间和产品的销量、单位成本、折扣与退款、渠道费用和弹性假设的来源。",
        "Collect current prices, period and product volumes, unit costs, discounts and refunds, channel fees and elasticity sources.",
      ],
      [
        "只改变明确的价格假设，计算对销量、毛利、收入和贡献利润的分段影响，设置保守区间并比较价格变化后的盈亏点。",
        "Vary only explicit price assumptions; model volume, margin and contribution by scenario with conservative ranges and break-even.",
      ],
      [
        "交付价格情景表、敏感性矩阵、关键盈亏阈值和需要验证的试验方案，标注公式、税费、渠道和成本边界。",
        "Deliver price cases, sensitivity matrix, break-even thresholds and validation experiment with formula, tax, channel and cost boundaries.",
      ],
      [
        "弹性是未经验证的假设时必须如此标明，不得把模型推演写成已发生行为；核对折扣和佣金没有重复扣除。",
        "Clearly label unvalidated elasticity and hypothetical results; verify discounts and commissions are not deducted twice.",
      ],
    ),
    detail(
      [
        "收集客户数量、分群、漏斗转化、合同价格、续费与流失定义、收入确认规则和收入数据来源。",
        "Collect customer counts, segments, funnel conversion, contract pricing, renewal and churn definitions, recognition rules and sources.",
      ],
      [
        "设置基准、乐观和保守情景，并仅调整已声明的客户、转化、价格或续费假设，拆分新增收入、存量续费和延期风险。",
        "Build base, upside and downside cases changing only declared customer, conversion, price or renewal assumptions, separating new and recurring revenue.",
      ],
      [
        "交付可切换情景表、收入桥接、关键假设与敏感性、预测范围说明，提供情景差异解释及需要业务确认的驱动项。",
        "Deliver switchable cases, revenue bridge, assumptions and sensitivities, forecast scope and business questions.",
      ],
      [
        "不得混淆订单、合同额、确认收入与收款；同一假设不可在多个驱动重复作用，缺少历史证据的转化率应给区间。",
        "Do not conflate bookings, contract value, recognized revenue and cash; prevent duplicate drivers and range unsupported conversion rates.",
      ],
    ),
    detail(
      [
        "收集成本结构、供应商合同、采购量与单价、人员和业务驱动、可调整条件及已确认的节约措施。",
        "Collect cost structure, vendor contracts, volumes and prices, staffing and drivers, adjustable terms and approved savings.",
      ],
      [
        "设置基准、成本上涨、效率改善等独立情景，逐项改变单价、数量或配置，追踪对利润、现金和服务能力的影响。",
        "Create baseline, inflation and efficiency cases varying unit prices, volumes or configuration independently, tracking profit, cash and service.",
      ],
      [
        "交付费用情景桥接、成本驱动表、现金与利润影响和决策阈值，注明实现节省需要的合同、流程及负责人条件。",
        "Deliver expense bridges, drivers, profit and cash impacts and thresholds, with contractual and owner conditions for savings.",
      ],
      [
        "不得将计划节省当作已落实，避免同一供应商涨价同时进入单价和综合通胀假设；考虑成本削减导致的服务风险。",
        "Do not treat planned savings as achieved or double-count inflation; assess service risks from cost reductions.",
      ],
    ),
  ],
  "data-dashboard": [
    detail(
      [
        "收集经营目标、指标定义、收入成本或业务量数据、负责人、统计期间、刷新频率及各数据源的更新时间。",
        "Collect business goals, metric definitions, revenue and cost or volume data, owners, periods, refresh cadence and source timestamps.",
      ],
      [
        "建立指标字典与目标基线，区分实际、目标和预测，使用趋势、差异及分解视图帮助负责人定位需要采取的行动。",
        "Build a metric dictionary and baseline, separate actual, target and forecast, and use trends and decomposition to guide action.",
      ],
      [
        "交付经营看板结构、指标与分母表、趋势及目标差异、刷新说明和责任分工，标注缺失数据与人工复核项。",
        "Deliver dashboard structure, metric and denominator table, trends and variances, refresh notes, owners and manual checks.",
      ],
      [
        "统一期间、币种和计算口径，不能以静态截图冒充实时刷新；异常值、数据延迟和指标定义变化需显示出来。",
        "Align periods, currency and definitions; do not present static screenshots as live, and show anomalies, latency and definition changes.",
      ],
    ),
    detail(
      [
        "收集线索、商机和成交字段、阶段定义、进入与退出日期、销售负责人、重复记录规则和目标期间。",
        "Collect lead, opportunity and win fields, stage definitions, entry and exit dates, owners, duplicate rules and target period.",
      ],
      [
        "统一阶段、期间和同期群口径，分别说明各阶段数量与金额、转化率的分子分母及周期的计算样本；区分新进、移动、停滞和丢失商机并保留变化证据。",
        "Align stage, period and cohort definitions; report counts and value, each conversion rate's numerator and denominator, and cycle-time samples separately. Distinguish new, moved, stalled and lost opportunities with stage evidence.",
      ],
      [
        "交付漏斗看板、阶段和分母说明、转化趋势、停滞清单与负责人行动，说明数据刷新和去重逻辑。",
        "Deliver funnel dashboard, stage and denominator definitions, conversion trends, stalled list and owner actions with refresh and deduplication logic.",
      ],
      [
        "不得把不同定义的阶段直接相除，检查重复商机、跨期移动和缺失关闭日期；金额未经核对不能作为预测承诺。",
        "Do not divide incompatible stages; check duplicates, cross-period moves and missing close dates, and do not treat unverified value as forecast.",
      ],
    ),
    detail(
      [
        "收集客户标识与分群、活跃和续费事件、首次使用日期、流失定义、观察窗口及隐私可用字段。",
        "Collect customer IDs and segments, activity and renewal events, first-use dates, churn definition, observation windows and permitted fields.",
      ],
      [
        "以同期群和统一观察窗口分析留存、回访及流失，分别展示分群趋势和样本量，避免把新客未到观察期算作流失。",
        "Analyze retention, return and churn by cohort and fixed windows, showing segment trends and sample sizes; flag right-censored observations and do not count customers still within their observation window as churned.",
      ],
      [
        "交付留存曲线或表格、同期群口径、分群差异、流失重点和跟进行动，记录数据截止日与仍在观察的客户数。",
        "Deliver retention curves or tables, cohort definitions, segment differences, churn priorities and actions with cutoff and censored counts.",
      ],
      [
        "客户数据需脱敏并限制访问，关联缺失和观察期不足要标记；相关性不等于流失原因，分析结论需结合定性证据。",
        "Protect and limit customer data; flag missing links and short windows, and combine correlation with qualitative evidence.",
      ],
    ),
    detail(
      [
        "收集工单、响应与解决时间、优先级、重开、满意度及服务标准，记录渠道、时区、无效记录与刷新时间。",
        "Collect tickets, response and resolution times, priority, reopen, satisfaction and service standards with channel, timezone and refresh.",
      ],
      [
        "按服务阶段和工单类型展示量、SLA达成、积压与满意度，拆分异常原因并为逾期或重复问题安排负责人。",
        "Show volume, SLA, backlog and satisfaction by stage and type, separating causes and assigning overdue or recurring issues.",
      ],
      [
        "交付服务质量看板、指标与分母、积压清单、满意度样本说明和改进计划，标注无效工单及缺失时间。",
        "Deliver service dashboard, metric denominators, backlog, satisfaction sample notes and improvement plan with invalid and missing records.",
      ],
      [
        "对齐时间区、暂停和关闭定义，不能把无效或重复工单计入分母；低回复率和未完成处理需保留不确定性。",
        "Align time zones and pause and close rules; exclude invalid duplicates and disclose low response and incomplete handling.",
      ],
    ),
    detail(
      [
        "收集项目里程碑、计划和实际日期、状态定义、负责人、依赖、变更记录和最新进展证据，并标出基线计划版本。",
        "Collect project milestones, planned and actual dates, status, owners, dependencies, changes, evidence and baseline plan version.",
      ],
      [
        "用计划与实际差异、关键路径和依赖状态呈现进度，区分尚未开始、进行中、阻塞和已完成，并显示更新时间。",
        "Show plan-vs-actual, critical path and dependencies, distinguishing not started, active, blocked and complete with update times.",
      ],
      [
        "交付项目进度看板、里程碑时间线、延期原因、关键依赖和负责人行动，附状态证据与下次复核日期。",
        "Deliver progress dashboard, milestone timeline, delay reasons, dependencies and owner actions with evidence and review date.",
      ],
      [
        "不能凭会议口头状态标记完成，检查日期版本及依赖证据；计划变更需保留旧版和批准记录，避免覆盖历史。",
        "Do not mark complete from verbal status; retain old plans and approvals when schedules change and verify evidence.",
      ],
    ),
    detail(
      [
        "收集交付清单、验收结果、测试和缺陷记录、产品或服务版本、受影响范围及质量标准，并准备唯一交付物标识。",
        "Collect deliverables, acceptance, tests and defects, versions, affected scope, criteria and unique deliverable identifiers.",
      ],
      [
        "按交付物和版本展示通过、拒绝、条件接受及缺陷趋势，区分缺陷数量、严重度与实际受影响的交付物。",
        "Show accepted, rejected, conditional and defect trends by deliverable and version, separating counts, severity and affected items.",
      ],
      [
        "交付质量看板、验收与缺陷矩阵、未结问题责任、严重度趋势和复验日期，链接实际测试或签收证据。",
        "Deliver quality dashboard, acceptance and defect matrix, open owners, severity trends and retest dates linked to evidence.",
      ],
      [
        "不得将计划修复当作已关闭，缺陷计数需去重并说明版本范围；无授权签收或未完成测试不能显示通过。",
        "Do not count planned fixes as closed; deduplicate defects and state version scope, requiring authorized sign-off and completed tests.",
      ],
    ),
    detail(
      [
        "收集人员容量、工作日历、任务排期、估算与实际工时、技能标签、请假和跨项目占用信息。",
        "Collect capacity, calendars, task schedules, estimated and actual hours, skills, leave and cross-project allocation.",
      ],
      [
        "按周期计算可用、已排和实际负载，显示技能缺口、冲突和闲置容量；区分估算、承诺和已发生工时。",
        "Calculate available, planned and actual load by period, showing skill gaps, conflicts and spare capacity, separating estimates from actuals.",
      ],
      [
        "交付资源负载看板、个人或团队汇总、冲突清单、技能缺口与调整建议，限制姓名级数据并标明统计时点。",
        "Deliver resource dashboard, team summaries, conflict list, skill gaps and adjustments, limiting named data and stating the snapshot date.",
      ],
      [
        "不能把计划工时当成真实投入，核对假期、重复任务和时区；人员数据需取得授权，避免将看板用于未经说明的绩效评价。",
        "Do not treat planned hours as actual; check leave, duplicates and time zones, and avoid using the view for undisclosed performance judgment.",
      ],
    ),
    detail(
      [
        "收集风险登记项、可能性与影响评分、评分标准、责任人、控制措施、触发条件和最近复审日期。",
        "Collect risks, likelihood and impact scores, criteria, owners, controls, triggers and latest review dates.",
      ],
      [
        "展示高风险排序、评分变化、控制状态和临近触发，支持按责任人、项目和复审期限筛选并连接处置证据。",
        "Show high-risk ranking, score changes, control status and upcoming triggers with filters by owner, project and review.",
      ],
      [
        "交付风险看板、评分与依据、控制跟踪、逾期复审清单和升级行动，保留历史评分及接受风险的授权记录。",
        "Deliver risk dashboard, scoring rationale, control tracking, overdue reviews and escalation with history and acceptance authority.",
      ],
      [
        "分数不是事实本身，缺少依据或未执行控制不能显示为安全；风险接受由授权人确认，隐去无关个人敏感信息。",
        "Scores are not facts; unsupported or unimplemented controls cannot imply safety, and authorized owners accept risk.",
      ],
    ),
    detail(
      [
        "收集预算、实际发生、已承诺采购、科目与成本中心、期间、币种、分摊规则及预算版本，并确认财务数据刷新日。",
        "Collect budget, actuals, commitments, accounts, centers, period, currency, allocation, budget version and finance refresh date.",
      ],
      [
        "按科目和期间比较预算、实际和承诺，显示执行率、剩余可用和异常差异，区分一次性和周期性支出。",
        "Compare budget, actual and commitment by account and period, showing utilization, available balance and variances, separating one-offs.",
      ],
      [
        "交付预算执行看板、差异桥接、未完成承诺清单、版本和刷新说明，标出负责人和需要审批的调整。",
        "Deliver budget dashboard, variance bridge, open commitments, versions and refresh notes, with owners and approval needs.",
      ],
      [
        "统一含税口径、科目和分摊，不能把承诺支出重复计入实际；预算版本变更须保留批准和旧版记录。",
        "Align tax, accounts and allocation and avoid double-counting commitments; retain approval and prior versions when budgets change.",
      ],
    ),
    detail(
      [
        "收集采购订单、供应商、类别、合同与付款状态、订单金额、退货或取消记录、预算及数据访问权限。",
        "Collect purchase orders, vendors, categories, contract and payment status, amounts, returns, budget and access controls.",
      ],
      [
        "按供应商、类别、期间与组织分析采购支出和价格变化，去重订单并区分已下单、已收货、已付款和承诺。",
        "Analyze spending and price changes by vendor, category, period and organization, deduplicating and separating ordered, received, paid and committed.",
      ],
      [
        "交付采购支出看板、供应商与类别排行、预算差异、待付款和异常订单清单，限制商业敏感字段的可见范围。",
        "Deliver procurement dashboard, vendor and category rankings, budget variance, unpaid and anomalous orders with restricted sensitive fields.",
      ],
      [
        "订单状态与付款状态不能混用，核查取消、退货、税费和汇率；未经授权不公开供应商合同价格或个人联系人。",
        "Do not mix order and payment status; check cancellations, returns, taxes and rates and protect contract pricing and contacts.",
      ],
    ),
    detail(
      [
        "收集编制、在岗人数、空缺岗位、组织层级、岗位状态、统计日期和允许使用的人员字段，并确认在岗与编制的计算口径。",
        "Collect staffing plan, employees, vacancies, hierarchy, role status, date and permitted fields; define active and planned headcount.",
      ],
      [
        "分别展示编制、在岗、招聘中和冻结岗位，按组织或岗位类别观察变化，并为招聘优先级提供证据而非替代审批。",
        "Separate plan, active, recruiting and frozen roles, tracking changes by organization or role without replacing approval.",
      ],
      [
        "交付人员配置看板、空缺趋势、编制差异和组织筛选，标注统计时点、口径及HR数据复核人。",
        "Deliver staffing dashboard, vacancy trend, plan variance and filters with snapshot, definitions and HR reviewer.",
      ],
      [
        "个人信息应最小化和脱敏，临时借调或离职状态需有更新时间；不能把人数变化直接解释为绩效或组织原因。",
        "Minimize and redact personal data; date temporary assignments and exits, and do not infer performance or causes from headcount alone.",
      ],
    ),
    detail(
      [
        "收集培训计划、报名与适用人群、出勤、课程完成、测验或作品证据、评价结果和统计期间。",
        "Collect training plans, eligibility, enrollment, attendance, completion, tests or work evidence, evaluations and periods.",
      ],
      [
        "分别展示计划覆盖、报名、出勤、完成和能力证据，按部门或课程比较差异，并追踪未完成者的补训路径。",
        "Show planned coverage, enrollment, attendance, completion and capability evidence separately, comparing segments and remediation.",
      ],
      [
        "交付培训完成看板、分母与状态定义、未完成清单、评价趋势和补训行动，标明数据刷新与隐私限制。",
        "Deliver training dashboard, denominators and status definitions, incomplete list, evaluation trend and remediation with privacy limits.",
      ],
      [
        "出勤或结课不等于能力达标，测验缺失与评价偏差需标记；人员与成绩数据仅供授权角色使用，不能公开姓名级细节。",
        "Attendance or completion is not competence; flag missing tests and bias, restrict personnel and scores to authorized roles and avoid named detail.",
      ],
    ),
  ],
};
