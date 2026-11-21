type PlaybookText = readonly [string, string];

export const LEGACY_CREATIVE_PLAYBOOKS: Readonly<
  Record<
    string,
    { inputs: PlaybookText; method: PlaybookText; design: PlaybookText; checks: PlaybookText }
  >
> = {
  "decision-deck": {
    inputs: [
      "收集决策事项、授权人、提出背景、待比较选项、现状基线、预算与时间约束，以及可追溯的业务数据和来源。确认各选项的适用条件、受影响团队和资料截止日期；缺少成本或收益依据时保留未知，不用示例数字代替真实决策材料。",
      "Collect the decision, authority, context, options, baseline, budget, timing, affected teams and dated evidence. Record missing cost or benefit evidence instead of using example figures as facts.",
    ],
    method: [
      "先写出决策问题和不采取行动的基线，再按相同的价值、总成本、风险、实施难度和可逆性比较可行方案。区分事实、预测和判断，说明推荐方案依赖的关键假设、反对意见与何时重新评估，最后列出需授权的事项和后续责任。",
      "State the decision and no-action baseline. Compare options using consistent value, full cost, risk, feasibility and reversibility; separate evidence from forecasts, state counterarguments, review triggers and the authorization sought.",
    ],
    design: [
      "以首页结论和明确决策请求开场，用比较表呈现共同标准及差异，证据页只放支持该结论的少量关键事实，并在页内标明来源和单位。风险、时间线和行动分别使用适合内容的版式，保持标题层级、留白与投影环境下的可读性。",
      "Open with the conclusion and decision request; use a common-criteria comparison, concise sourced evidence and separate risk, timeline and action slides. Maintain hierarchy, whitespace and projection readability.",
    ],
    checks: [
      "逐项检查候选方案是否使用一致的期间和成本边界，确认比较权重、数字来源、风险责任人与申请授权的权限层级；对缺失数据和未决假设明确标示。重新打开实际演示文件检查顺序、溢出和可编辑性，未能渲染或逐页复核时如实披露。",
      "Check comparable periods, costs, weights, sources, risk owners and authority. Identify missing assumptions; inspect the actual editable deck and disclose any unavailable rendering or visual review.",
    ],
  },
  "company-narrative": {
    inputs: [
      "收集组织介绍、使命、真实产品或服务、经确认的里程碑、当前业务范围和可公开的客户案例。核对资料时间、数据口径、演讲对象、时长及品牌素材的使用授权；涉及合作方名称和员工照片时先确认对外披露范围。",
      "Gather the organization's mission, actual products or services, verified milestones, approved cases, audience and duration. Check dates, metric definitions and permission to use partner names, photos and brand assets.",
    ],
    method: [
      "从受众关心的问题出发组织背景、洞察、实际能力和证据，再连接下一步合作或交流请求。已达成结果、发展目标和未经证实的愿景必须分别表述；选择少量能解释价值的真实案例，并交代适用背景和不能外推的限制。",
      "Build a narrative from the audience's problem through insight, actual capabilities and evidence to a concrete next step. Separate achieved results from aspirations and explain the limits of approved examples.",
    ],
    design: [
      "先绘制整套演示的标题链，每页只承担一个信息任务；公司时间线、产品能力、客户价值与下一步分别采用合适的页面结构。尽量使用经授权的真实产品界面和清晰文字，不用空洞大词或装饰图片挤占论证空间。",
      "Storyboard a coherent title sequence with one job per slide. Use distinct structures for milestones, capability, customer value and next steps; prefer authorized product imagery and clear text to decorative filler.",
    ],
    checks: [
      "对照公司公开资料逐一核对名称、日期、规模、案例授权和联系方式，区分已经上线、计划中与仅供讨论的能力。检查不同页面是否重复、跳跃或承诺超出事实；打开实际文件复核图像与文字，无法进行真实渲染时标记未验证。",
      "Verify names, dates, scale, case permissions, contact details and capability status against approved sources. Review narrative continuity and actual slides; disclose missing rendering or visual checks.",
    ],
  },
  "product-launch": {
    inputs: [
      "收集已确认的产品能力、目标用户、版本范围、可用地区、测试记录、已知问题、兼容条件和发布计划。取得可公开界面、素材授权、各渠道负责人和支持方式；未确定的价格、日期或功能状态单列为待确认，不提前写成承诺。",
      "Collect confirmed capabilities, users, release scope, availability, tests, known issues, compatibility and channel ownership. Use approved assets and leave uncertain dates, prices and features unresolved.",
    ],
    method: [
      "围绕用户任务说明发布带来的变化，再把体验证据映射到实际能力与目标人群。依次安排发布前检查、试点或分批开放、外部沟通、指标观察和异常处理；每个阶段写明负责人、准入条件、停止信号及经验证的回退路径。",
      "Explain the user-facing change and map each claim to evidence. Sequence readiness, pilot or phased rollout, communication, monitoring and incident response with owners, gates, stop signals and verified rollback paths.",
    ],
    design: [
      "封面明确产品、发布主题与日期状态，后续用真实界面展示关键任务路径；发布节奏、就绪度和已知问题分别采用时间线、状态表及备注。区分对外宣传与内部检查内容，以清楚的结论标题、统一图例和可读截图组织页面。",
      "Identify the product and release status up front; illustrate key workflows with approved real screens. Separate the schedule, readiness, known issues and internal notes using legible, consistently labeled layouts.",
    ],
    checks: [
      "逐项核对宣传语、截图、版本号、渠道时间、使用条件与实际测试记录是否一致，检查已知限制和受影响用户是否被遗漏。未执行的试点、监控或回退演练必须保留未验证状态；审阅可编辑页面并如实记录渲染检查结果。",
      "Reconcile claims, screenshots, versions, channel dates and availability with actual test evidence; retain known limitations and mark unperformed pilots, monitoring, rollback or rendering checks unverified.",
    ],
  },
  "training-deck": {
    inputs: [
      "收集学员岗位、已有基础、学习目标、可用课时、现行操作资料、演示环境和讲师资源。确认需要练习的任务、课堂设备、评价标准与敏感案例的使用许可；无法使用真实系统时准备明确标注的练习材料，不暴露账号或凭据。",
      "Gather learner roles, prior knowledge, objectives, duration, current procedures, demo environment and assessment criteria. Obtain case permissions and use labeled practice materials without exposing credentials.",
    ],
    method: [
      "将学习目标写成能够观察的行为，再对齐讲解、示范、分步练习和评估证据。每个核心知识点至少安排正常示例或反例，复杂任务说明判断点与常见错误；按学员基础提供提示，并设计课后迁移任务和反馈责任人。",
      "Express objectives as observable behaviors and align explanation, demonstration, guided practice and assessment. Include examples, decision points, common errors, differentiated support and a workplace transfer task.",
    ],
    design: [
      "按目标、演示、练习、反馈和复盘安排页序，以简短指令和足够留白支持课堂阅读；流程、对照或步骤截图按教学目的选择。涉及讲师提示时保留备注和时间安排，练习题与参考答案区分，避免单页长段文字。",
      "Sequence objectives, demonstrations, practice, feedback and reflection. Use legible instructions, suitable diagrams and speaker notes; separate exercises from answers and avoid dense slides.",
    ],
    checks: [
      "检查目标是否能通过指定练习或观察评价，讲师安排与总时长是否匹配，练习材料、提示和反馈标准是否齐全。安全操作、制度与示例数据交适当负责人复核；检查实际课件的文字裁切和备注，不能渲染时说明限制。",
      "Check objective-to-assessment alignment, timing, practice materials and feedback criteria. Have appropriate owners verify safety and policy content; inspect slides and notes and disclose rendering limitations.",
    ],
  },
  "project-kickoff": {
    inputs: [
      "收集立项授权、业务目标、范围说明、干系人名单、现有计划、资源预算、交付物及已知依赖。核实参与团队、客户或供应商职责、里程碑日期和可用资料版本；未批准的人员、预算和外部承诺不得写成已经确定。",
      "Collect authorization, objectives, scope, stakeholders, plans, budget, deliverables and dependencies. Verify cross-team responsibilities, dates and versions; do not present unapproved resources or commitments as settled.",
    ],
    method: [
      "从项目目标和成功定义推导范围内外事项及成果分解，再按工作流列出负责人、审批人、关键依赖与阶段验收。为跨团队接口明确交付内容和接收条件，识别主要风险、升级路径和首次会议需要决定的问题。",
      "Derive scope and deliverables from the objective and definition of success. Assign owners and approvers, document interfaces and acceptance gates, and identify risks, escalation paths and kickoff decisions.",
    ],
    design: [
      "用简洁的目标与范围页建立共同背景，以责任矩阵、里程碑路线图和依赖表支撑协作；风险和待决事项使用文字状态及明确责任人。区分计划与已确认事项，控制表格密度，确保会议投影和会后阅读均可理解。",
      "Use concise objective and scope slides, followed by a responsibility matrix, milestones and dependencies. Label risks and decisions with owners and confirmation status, keeping tables readable in meetings.",
    ],
    checks: [
      "核对目标、范围、交付、预算与授权是否一致，检查每个里程碑是否有完成条件和责任人，每个依赖是否指定双方接口。未确认的日期、决定和资源单列待办；复核实际演示中的遗漏、分页与可编辑状态，并记录渲染边界。",
      "Reconcile objectives, scope, deliverables, resources and authority; check milestone completion criteria and interface ownership. Preserve unconfirmed items and disclose actual editing and rendering checks.",
    ],
  },
  "client-proposal": {
    inputs: [
      "收集客户提出的问题、需求和约束、访谈记录、已有合同或询价要求、适用服务范围及可公开案例。核对客户决策标准、参与角色、交付周期、预算假设、知识产权和报价审批状态；未知信息和未经确认的需求保持待定。",
      "Gather the client's stated problem, constraints, interviews, contract or request, decision criteria, scope and approved examples. Record timing, pricing assumptions, intellectual property and unresolved needs.",
    ],
    method: [
      "先复述客户问题并区分客户原话与我方判断，再将解决路径拆成阶段、具体交付、客户依赖和验收方式。用证据支持预期价值，同时说明范围排除项、费用假设、变更流程、风险以及需要双方进一步确认的商业条款。",
      "Separate the client's stated problem from our interpretation. Map the proposed phases to deliverables, client dependencies and acceptance; explain evidence, exclusions, pricing assumptions, changes and unresolved terms.",
    ],
    design: [
      "按照客户问题、方案、证据、实施和下一步组织演示，首页说明本次讨论目的，方案页用流程或责任对照展示工作，不用公司介绍淹没客户需求。统一报价与范围的标识，使用获授权案例及清晰的来源说明。",
      "Organize the deck around the client's problem, approach, evidence, delivery and next step. Show responsibilities clearly, keep company background brief and use only authorized cases and consistent scope labels.",
    ],
    checks: [
      "对照客户资料核对组织名称、问题陈述、时间、费用口径和案例许可，确保交付范围与责任及验收条件一致。未审批报价、收益预测、合同效力和客户同意不能写成已确认；审阅实际页面、溢出与渲染结果并如实披露。",
      "Verify the client's name, problem, timing, pricing basis and case permissions; align scope, responsibilities and acceptance. Do not claim unapproved prices, outcomes or agreement; report actual slide checks.",
    ],
  },
  "strategy-brief": {
    inputs: [
      "收集当前战略、经营目标、历史表现、客户和市场证据、能力清单、资源约束及相关决策记录。逐项记录数据期间、指标定义、来源和可公开范围；无法验证的行业预测、竞争者信息与尚未批准的目标应单独列为假设。",
      "Gather current strategy, goals, historical performance, market and customer evidence, capabilities, resources and prior decisions. Record periods, definitions and sources; flag unsupported forecasts or unapproved goals.",
    ],
    method: [
      "先明确业务所处变化和需要解决的战略问题，再比较可行方向及不选择的代价。把选择连接到目标客群、核心能力、资源配置、阶段行动和衡量指标，说明关键假设、反方观点、风险信号与重新评估的触发条件。",
      "Define the strategic question and changes in context, compare alternatives and opportunity costs, then connect the choice to customers, capabilities, resources, actions and measures. Document assumptions and review triggers.",
    ],
    design: [
      "文档首页给出判断、选择和需要的决策，其后按环境证据、取舍、行动和衡量展开；重要比较采用精简表格，复杂数据保留来源附录。使用语义标题和一致编号，控制表格宽度与长段落，便于管理者快速定位和批注。",
      "Lead with the judgment, choice and decision request, followed by evidence, tradeoffs, actions and measures. Use concise comparison tables, an evidence appendix and accessible headings for review.",
    ],
    checks: [
      "核对目标与事实、预测是否混用，检查战略取舍是否对应资源变化，行动是否有责任和时间，指标是否明确基线与口径。缺少授权或证据的判断标记待审；回读实际文档，按可用环境检查分页与渲染并报告未验证内容。",
      "Separate goals from actual results and forecasts; check resource implications, action ownership and metric baselines. Flag unsupported judgments and disclose actual document and rendering checks.",
    ],
  },
  "project-charter": {
    inputs: [
      "收集立项请求、发起人授权、问题背景、预期成果、范围草案、预算、人力和关键干系人资料。确认项目与外部合同的关系、已存在的约束与依赖、批准流程和现行版本；未签署的权限或资源投入不能被默认为正式授权。",
      "Gather the project request, sponsor authority, background, outcomes, draft scope, resources, stakeholders and applicable agreements. Verify dependencies and approval status without assuming unsigned authority.",
    ],
    method: [
      "把项目目的转成可验收的成果和衡量标准，明确纳入与排除范围、决策权限、主要角色和阶段里程碑。对预算、跨团队依赖、风险及变更请求设置责任人与升级路径，列出签署前仍需解决的问题和授权人需要决定的事项。",
      "Translate purpose into measurable outcomes, included and excluded scope, decision rights, roles and milestones. Assign ownership and escalation for resources, dependencies, risks and changes; list items requiring approval.",
    ],
    design: [
      "首页呈现章程版本、发起人、目标和批准状态，正文按范围、成果、责任、时间、资源及治理分节。用简洁责任矩阵和里程碑表代替冗长清单，签署区只提供待确认位置，不生成虚构签名或将草案排成已经批准的正式文件。",
      "Show the version, sponsor, objectives and approval state up front; organize scope, outcomes, roles, schedule, resources and governance with readable matrices. Leave sign-off genuinely pending.",
    ],
    checks: [
      "检查章程中的成果、范围、预算和里程碑是否互相匹配，核实责任人、审批人、变更授权和外部依赖是否有来源。对未批准信息和冲突条款标记待确认，检查文档表格和分页；未经真实签署不得宣称章程已经生效。",
      "Reconcile scope, outcomes, budget and milestones; verify decision authority and external dependencies. Flag conflicts or missing approvals and never claim the charter is effective without real sign-off.",
    ],
  },
  "policy-playbook": {
    inputs: [
      "收集现行制度、适用人员和组织范围、责任部门、相关流程、审批矩阵和已有例外记录；核对制度版本、生效日期、发布渠道与规定的保留期限。法律依据或地区要求缺失时列出待法务确认事项，不自行编造条款和期限。",
      "Gather current policies, affected groups, owners, procedures, approval matrices and exceptions. Verify versions and effective dates; leave missing legal requirements or retention periods for qualified review.",
    ],
    method: [
      "区分必须遵守的要求、建议做法和待批准草案，逐项说明适用条件、责任人、审批权限、例外处理与记录要求。根据真实制度设计申诉、升级和定期复审路径，涉及法律或劳动问题时明确由具备资格的负责人审定。",
      "Distinguish mandatory requirements, recommendations and drafts. Define applicability, ownership, approvals, exceptions, records and review paths; refer legal and employment questions to qualified reviewers.",
    ],
    design: [
      "在封面或首页展示制度名称、版本、适用范围、负责人及批准状态，正文用语义标题组织原则、职责、流程、例外与维护。步骤或审批矩阵使用短表格并保持列名明确，必要时提供词汇说明和版本变更记录。",
      "Display the policy name, version, scope, owner and approval status. Organize principles, responsibilities, procedures, exceptions and maintenance with semantic headings and concise approval tables.",
    ],
    checks: [
      "核对制度条款与来源版本、授权矩阵和实际流程是否一致，检查职责是否冲突、例外是否有审批及复审安排。未经法务和负责人确认的引用与要求标记待核验；实际文档的表格、分页和权限由可用工具或用户分别检查。",
      "Check policy text against its source version, authority and real processes, including conflicts and exception review. Flag unverified legal claims and report document, pagination and access checks separately.",
    ],
  },
  sop: {
    inputs: [
      "收集当前作业流程、设备或系统说明、岗位职责、输入与输出、适用安全规范、异常记录和批准版本。确认操作人员具备的权限、工具、工作环境及升级联系人；涉及危险操作时必须由合格人员提供和核准现场要求。",
      "Gather current procedures, equipment or system instructions, roles, inputs, outputs, safety rules and exceptions. Confirm authorized operators and escalation contacts; qualified personnel must approve hazardous-work requirements.",
    ],
    method: [
      "按照作业前准备、逐步执行、结果核验、记录交接和收尾组织程序，每一步写明动作、必要输入、预期结果及责任角色。对缺件、异常、授权不足或安全条件不满足列出停止条件和升级路径，不擅自补造现场参数。",
      "Sequence preparation, execution, result checks, handoff and closure. Give each step its inputs, action, expected result and owner, with explicit stop and escalation conditions for missing evidence or unsafe conditions.",
    ],
    design: [
      "首页注明适用范围、作业角色、版本和安全提示，正文用编号步骤和简短检查表呈现；较复杂的判定放在条件与处理对照表中。按真实流程顺序排版，避免把警告埋入长段落，并预留人工填写的记录位置。",
      "Show scope, role, version and safety warnings first; use numbered steps and concise checklists, with decision tables for exceptions and space for actual operational records.",
    ],
    checks: [
      "由熟悉作业的负责人核对步骤顺序、前置条件、风险控制、停止点与实际工具，抽查正常和异常路径是否均可执行。没有现场试运行、审批或培训证据时明确未验证；检查文档排版和可读性，不将草案视为现行规程。",
      "Have an operational owner review sequence, prerequisites, controls and normal and exception paths. Mark site trials, approval or training as unverified when absent and do not present a draft as current policy.",
    ],
  },
  "research-report": {
    inputs: [
      "收集研究问题、委托方需要作出的决定、适用范围、已有资料、原始数据和检索时间。为每份资料记录作者、发布日期、版本、来源位置及可核查性；如涉及访谈、问卷或受限数据，应核对使用授权、样本选择和个人信息处理范围。",
      "Collect the research question, decision, scope, available evidence and search date. Record source authors, dates, versions and locations, and verify authorization and sampling for interviews, surveys or restricted data.",
    ],
    method: [
      "将研究问题分解为可检验的子问题，说明资料筛选、样本与分析方法，再把主要发现关联到具体证据。比较相互矛盾的来源并保留反例，区分直接观察、研究者解释和建议；无法支持的因果结论或总体推断应明确标示局限。",
      "Break the question into testable parts, explain source selection, samples and analysis, and link findings to evidence. Retain counterevidence and distinguish observation, interpretation, recommendation and unsupported causal claims.",
    ],
    design: [
      "首页摘要说明问题、主要发现、建议与证据限制，正文按研究方法、发现、讨论和行动组织。表格及图表注明单位、时间范围和数据来源，引用保留可核对的位置；把复杂样本、数据字典和补充材料放入附录，避免正文失去主线。",
      "Lead with the question, findings, recommendations and limitations. Structure methods, findings, discussion and actions; label charts and citations, and place detailed samples or data dictionaries in appendices.",
    ],
    checks: [
      "逐项核实引用是否真实可访问且支持对应论断，检查样本量、分母、时间、单位、统计方法和结论强度。不能访问或无法独立确认的资料如实披露；检查文档标题、图表说明与分页，实际未执行的渲染或人工复核不得标为通过。",
      "Verify that accessible sources support each claim, and check sample size, denominators, periods, units and inference strength. Disclose inaccessible evidence and any unperformed rendering or human review.",
    ],
  },
  "technical-evaluation": {
    inputs: [
      "收集技术目标、当前架构、候选方案、接口与数据约束、部署环境、维护能力、预算以及已有测试结果。记录软件版本、许可证、数据敏感级别、负载和假设；缺少真实环境、供应商资料或性能数据时应标记证据缺口。",
      "Gather objectives, architecture, candidate options, interfaces, data constraints, deployment environment, maintenance capacity, budget and test results. Record versions, licenses, workloads and evidence gaps.",
    ],
    method: [
      "先定义必须满足的功能、安全、可靠性和兼容条件，再用一致标准比较可行方案的实施、运维、迁移、成本和退出难度。性能结论需对应负载、环境、测量方式与样本；无法实测时保留验证计划，不把厂商宣传当作内部基准。",
      "Define mandatory functional, security, reliability and compatibility constraints, then compare implementation, operations, migration, cost and exit. Tie performance claims to workload, environment and measurement; label untested claims.",
    ],
    design: [
      "以结论摘要和适用条件开篇，随后给出约束、方案对照、证据、风险、验证计划与建议决策。比较表应保留标准定义及不确定状态，架构关系以可阅读的表格或获得授权的图示表达，附录记录版本和测试环境。",
      "Start with the recommendation and applicability, followed by constraints, comparison, evidence, risks and validation plan. Use defined criteria and readable diagrams or tables, retaining version and environment details.",
    ],
    checks: [
      "检查方案是否满足硬约束、比较范围是否一致、测试数据能否复现，以及安全与许可证问题是否交相应负责人复核。对未执行的部署、压测、故障恢复和兼容性测试单列状态；回读实际文档并如实说明渲染或环境验证限制。",
      "Check mandatory constraints, comparable scope, reproducibility, security and license review. List unperformed deployment, load, recovery and compatibility tests and disclose document-rendering limits.",
    ],
  },
  "meeting-brief": {
    inputs: [
      "收集会议议题、日期和时区、参会及缺席人员、议程、经授权的记录、展示材料和会后补充。明确哪些资料可以分发、哪些发言需要匿名处理，以及决策权归属；未提供录音或会议记录时不得凭空补写讨论过程。",
      "Gather the agenda, dated meeting and time zone, attendees, authorized notes, materials and follow-up. Confirm distribution and anonymity rules; never invent discussion when records are missing.",
    ],
    method: [
      "按议题整理背景、核心讨论、已作出的决定与尚待批准的问题，将每项行动关联责任人、期限和依赖，并区分会前既有事项与本次新增事项。遇到观点冲突保留不同立场及证据，不把参会沉默当作同意，也不把讨论建议写成正式决议。",
      "Organize each topic into context, discussion, actual decisions and pending approvals. Assign actions, owners, dates and dependencies, distinguishing existing from new actions; preserve disagreements without treating silence as consent.",
    ],
    design: [
      "首页突出会议目的、已确认决定和最重要的待办，正文按议题分节，行动表使用事项、责任人、期限、状态和来源列。内部敏感备注与可对外分发内容清楚区分，时间统一标注日期与时区，便于会后追踪。",
      "Lead with purpose, confirmed decisions and priority actions. Use a topic structure and an action table with owners, due dates, states and sources; separate sensitive internal notes from distributable content.",
    ],
    checks: [
      "将姓名、日期、数字、引语及每项决定逐条与原始记录核对，检查行动是否有明确责任人和可执行期限，并确认引用的附件版本与会议材料一致。无法确认的事项标待核实，缺席者意见不得推测；检查分发范围、文档可读性和实际渲染状态。",
      "Verify names, dates, figures, quotations, decisions, attachment versions and action ownership against the notes. Flag uncertainty, respect distribution limits and report actual document and rendering checks.",
    ],
  },
  "brand-campaign": {
    inputs: [
      "收集传播目标、目标受众、产品真实能力、品牌规范、预算、时间、渠道限制以及获授权的标识、照片和案例。核对各平台适用规格、素材使用期限和对外审批人；缺少市场数据、客户许可或渠道预算时应明确列出。",
      "Collect objectives, audience, actual product capabilities, brand guidance, budget, dates, channel constraints and licensed assets. Verify platform specifications, usage periods and required approvals.",
    ],
    method: [
      "先定义传播对象及希望产生的行为，再构建核心信息、证据和渠道分工；按预热、发布、持续沟通及复盘安排动作。每项指标写明基线、计算口径和观察窗口，对创意、资源、法务及突发舆情设置责任与升级条件。",
      "Define the audience and desired action, then connect messages to evidence and channels. Plan launch phases and measurement with baselines, definitions, owners, approval and incident escalation.",
    ],
    design: [
      "提供可编辑的传播方案与内容样稿，用受众、信息、渠道、时间、负责人和审批状态组织计划。网页交付时以真实素材和可读结构呈现核心信息，检查屏幕宽度及键盘访问；创意样稿不伪装成已经上线的活动页面。",
      "Deliver an editable campaign plan with audience, message, channel, schedule, owner and approval state. For HTML, use authorized assets, readable responsive layouts and accessible controls without claiming publication.",
    ],
    checks: [
      "逐项核验产品表述、数字、案例及素材授权，检查预算是否重复计入、指标口径是否一致、各渠道时间与责任是否明确。未获得批准或未发布的内容保持草稿状态；只报告实际完成的浏览器、链接和视觉检查。",
      "Verify product claims, figures, case and asset permissions, budgets, metric definitions and ownership. Keep unapproved or unpublished work in draft and report only browser and visual checks actually performed.",
    ],
  },
  "poster-campaign": {
    inputs: [
      "收集海报用途、受众、主题、标题、时间地点、报名入口、品牌规范和可用素材，确认信息的最终版本与审批人。核对图片、字体和标识的使用授权，以及工具支持的页面尺寸；缺少活动时间或入口时标记待补，不虚构二维码。",
      "Gather purpose, audience, theme, headline, dates, location, registration details, brand guidance and authorized assets. Confirm supported page size and leave missing event details or QR destinations unresolved.",
    ],
    method: [
      "按受众需要建立信息优先级，先确定主标题、核心价值和行动入口，再安排时间地点、补充说明与品牌信息。内容需要辨认时优先选择清楚的真实素材，分别设计远距离阅读与近距离查看的层次，不以装饰取代活动事实。",
      "Prioritize the audience's task: headline, key message and action, then logistics, supporting detail and branding. Use recognizable, authorized imagery and a hierarchy suited to distant and close reading.",
    ],
    design: [
      "在支持的纸张范围内规划版面，统一边距、对齐、文字层级与留白，确保主题、时间和入口不会被图片覆盖。对比色用于强调重要信息而非堆叠装饰；若需其他尺寸、印刷规格或可编辑源格式，应根据实际工具能力说明限制。",
      "Design within supported page sizes with consistent margins, alignment, typography and whitespace. Keep key details unobstructed; disclose limits on other sizes, print specifications and editable source formats.",
    ],
    checks: [
      "逐字核对活动名称、日期、地点、联系人及入口地址，确认图像和品牌素材授权。检查文字提取、清晰度、对比度与裁切；只有实际渲染并检查页面才能说明视觉核验，未验证的目标尺寸或印刷要求应另行披露。",
      "Verify event text, dates, contacts, destinations and asset rights. Inspect text extraction, legibility, contrast and clipping only when actually rendered; disclose unverified dimensions or print requirements.",
    ],
  },
  "social-campaign": {
    inputs: [
      "收集传播主题、目标受众、平台和账号定位、真实产品信息、已有素材、发布时间范围与审批要求。核对各渠道格式、素材使用权和受众隐私；没有客户授权、已确认数据或外部链接时保留缺口，不编造评价或传播效果。",
      "Gather the topic, audience, platform, account voice, verified product facts, assets, schedule and approval rules. Check format and usage rights; do not invent testimonials, links or results.",
    ],
    method: [
      "依据受众关心的问题确定信息主线和预期行动，再为不同渠道调整标题、正文长度、证据和发布时间建议。将事实、观点与推广承诺分开，设计评论或反馈处理分工，并明确每篇内容的责任、审批与可衡量目标。",
      "Define an audience problem, message and desired action, then adapt copy and evidence to each channel. Separate facts from opinion and claims; assign review, feedback handling and measurable objectives.",
    ],
    design: [
      "以可编辑内容清单展示主题、渠道、文案、素材、负责人、计划日期和审批状态；较长内容采用分段与小标题。若生成网页预览，检查阅读顺序、移动端换行和真实链接，草稿应清楚标识，不声称已经连接或发布到平台。",
      "Provide an editable calendar with copy, assets, channel, owner, date and approval state. For web previews, inspect reading order, mobile wrapping and actual links; clearly label drafts as unpublished.",
    ],
    checks: [
      "核对人名、产品能力、数据来源、素材授权、链接目标及敏感表述，检查各渠道版本与审批记录是否一致。预测曝光和互动不等于实际结果；缺少平台登录、发布回执或浏览器验证时应如实说明未完成与未验证项目。",
      "Verify names, claims, data, rights, links, sensitive language and approvals. Forecast engagement is not an actual result; disclose missing platform publication receipts or browser verification.",
    ],
  },
  "lesson-plan": {
    inputs: [
      "收集课程主题、学生年龄或基础、学习目标、课时、教材版本、可用设备及教师提供的评价要求。确认教学场地、可访问条件、案例使用许可和课程标准；缺失的学情与教材内容列为待确认，不假装已完成课堂观察。",
      "Gather topic, learner background, objectives, duration, materials, equipment and assessment requirements. Confirm accessibility and case permissions; disclose unknown learner context or unobserved classroom conditions.",
    ],
    method: [
      "把目标转为学生可展示的行为，按导入、讲解、示范、练习、反馈与总结设计时间分配。为每个主要目标安排检查方式，预测常见误解并准备提示和替代练习；作业应能够迁移到新的情境且由教师复核答案。",
      "Express outcomes as observable learner behavior; time the introduction, teaching, demonstration, practice, feedback and reflection. Align checks with objectives and prepare misconception support and teacher-reviewed transfer work.",
    ],
    design: [
      "教案首页列主题、对象、课时、目标和准备，主体采用环节、时间、教师活动、学生活动、资源及评价证据的清晰结构，必要时为不同基础的学生标明补充支持。练习题、参考答案与教师备注分区，避免把需保密答案直接混入学生发放版。",
      "Show topic, audience, duration, objectives and preparation, then organize stages by time, activities, resources and assessment, including differentiated support where needed. Separate exercises, answer keys and teacher-only notes.",
    ],
    checks: [
      "核对教学环节的时长总和、目标与练习的对应关系、答案和引用的准确性以及设备替代方案。学生数据和案例使用须符合实际授权；由教师确认教学适切性，检查文档分页与表格，未进行课堂试讲或渲染则明确标注。",
      "Check total timing, objective-practice alignment, answers, sources and equipment alternatives. Obtain teacher review and appropriate data permission; disclose missing classroom trials or rendering checks.",
    ],
  },
  "curriculum-design": {
    inputs: [
      "收集培养对象、岗位或学科能力要求、已有课程、学生起点、周期与总课时、讲师资源及考核限制。核对能力标准版本、教材许可、教学场地和可能的先修要求；没有完成需求调研或外部认证时不得写成已经确认。",
      "Gather learner groups, capability requirements, existing courses, starting levels, duration, instructor capacity and assessment constraints. Verify standards and prerequisites; do not invent research or accreditation.",
    ],
    method: [
      "从目标能力倒推学习成果和评价证据，再设计先修关系、课程模块、实践活动与阶段检查。识别不同起点的支持路径，说明内容取舍、实际资源依赖、讲师责任与课后迁移；对尚未验证的课时和能力提升保留假设。",
      "Work backward from capabilities to outcomes and assessment, then sequence prerequisites, modules, practice and checkpoints. Plan differentiated support, resource dependencies and transfer, labeling untested assumptions.",
    ],
    design: [
      "用课程地图说明模块顺序与依赖，再以矩阵对应目标能力、课程、练习、评价方式和责任人，并标明每个阶段衔接时需要的先修基础。课程大纲分别列对象、学时、关键活动及交付材料，保持名称与编号一致；把可选内容与核心要求清楚区分。",
      "Use a curriculum map and a matrix linking capabilities, modules, practice, assessment and owners, with prerequisites for each stage. List audiences, hours and materials consistently and distinguish optional from required content.",
    ],
    checks: [
      "检查每项核心能力是否有教学活动和可观察的评价，先修顺序、总课时、讲师负载及资源是否合理。外部认证、合规要求与实际开课条件须由负责人核实；文档生成不等于课程已试教或学习成果已经验证。",
      "Check capability coverage, observable assessment, prerequisites, total hours, instructor capacity and resources. Require verification of external credentials and make clear that a document does not prove teaching or outcomes.",
    ],
  },
  "financial-model": {
    inputs: [
      "收集已授权的历史实际、预测期间、业务驱动、价格和数量、成本项目、现金收付时间、币种与批准假设。为口径、来源、责任人及版本留痕；缺少税率、汇率、借款条件或会计政策时列入待确认，不填入看似真实的示例数值。",
      "Collect authorized actuals, forecast periods, operating drivers, prices, volumes, costs, cash timing, currencies and approved assumptions. Record sources and owners; leave unknown rates or policies unresolved.",
    ],
    method: [
      "按期间与业务粒度连接收入、成本和现金驱动，分开实际、预测和情景假设；明确每项公式的输入及计算关系，避免重复计列。基准、乐观和保守情景只改变明示参数，利润与现金不混同，资金缺口需人工确认。",
      "Link revenue, cost and cash drivers by period and grain, separating actuals, forecasts and assumptions. Make formulas traceable, avoid double counting, vary explicit scenario parameters and distinguish profit from cash.",
    ],
    design: [
      "工作簿分设说明、原始数据、假设参数、期间计算、情景汇总和勾稽检查，编号保留为文本，金额及期间标明币种和单位。将输入与公式用文字图例区分，冻结关键表头并按需筛选；敏感数据只在授权范围内最小化呈现。",
      "Separate instructions, source data, assumptions, calculations, scenarios and checks. Label currency and periods, preserve identifiers as text, distinguish formulas from inputs, and minimize sensitive data.",
    ],
    checks: [
      "核对期间汇总与明细、期初期末余额以及预算与预测的口径，抽查零分母、符号、汇率和跨期重复。独立检查公式并记录实际重算结果；本机没有可用重算环境或抽查不完整时标记未验证，不将模型预测当作审计结论。",
      "Reconcile detail to totals and opening to closing balances; review denominators, signs, currencies and period overlaps. Check formulas and disclose unavailable or partial recalculation; forecasts are not audited results.",
    ],
  },
  "data-dashboard": {
    inputs: [
      "收集业务问题、目标读者、指标定义、数据表、统计期间、组织或客户维度及已知刷新频率。核实数据来源、提取时点、字段字典、授权范围和历史目标；缺少分母、维度或数据刷新证据时不能将看板结果描述成实时事实。",
      "Gather the business question, readers, metric definitions, source tables, periods, dimensions and refresh cadence. Verify extraction time, data dictionary and permissions; disclose missing denominators or freshness evidence.",
    ],
    method: [
      "先确定每项指标的分子、分母、粒度、单位、时间窗口和目标值，再处理缺失、重复与异常数据。按趋势、构成、目标差异及需要采取的行动选择展示内容；区分相关性、原因与未经证实的解释，不把空值自动填成零。",
      "Define each metric's numerator, denominator, grain, unit, period and target; handle missing, duplicate and anomalous data explicitly. Select actionable trends or comparisons and do not infer causation or replace missing data with zero.",
    ],
    design: [
      "分离原始数据、指标定义、计算、汇总与异常明细，工作表标题说明期间、单位和更新时间；对比项使用一致口径。用文本标签配合颜色，保持表头固定并允许筛选；只有可用工具支持时才选择相应图表或交互表达。",
      "Separate source data, definitions, calculations, summary and exceptions. Label period, units and freshness, use comparable measures and text alongside color, and use charts or interactions only when supported.",
    ],
    checks: [
      "把看板汇总与来源明细勾稽，抽查指标分母、筛选条件、重复记录、跨期与币种差异，确认缺失数据和目标口径已说明。公式与渲染分别记录实际状态；不能因为文件打开成功就声称数据已刷新或结论已验证。",
      "Reconcile summaries to source records; inspect denominators, filters, duplicates, periods, currencies and missing values. Report formula and rendering status separately without claiming automatic refresh or validated conclusions.",
    ],
  },
  "business-case": {
    inputs: [
      "收集拟议投资的目标、决策期限、不实施基线、阶段投入、收入或效率驱动、运营成本及资金来源。记录成本和收益的期间、币种、责任人、证据及批准状态；缺少实际价格、税费或收益实现条件时列为假设，不虚构确定回报。",
      "Gather the investment objective, decision timing, no-action baseline, phased costs, benefit drivers and funding sources. Record periods, currency, owners and evidence; label missing prices or benefits as assumptions.",
    ],
    method: [
      "比较维持现状与可行方案，分别估算一次性投入、持续成本、增量收益及现金发生时间，说明贴现等方法需要的经批准参数。避免把节省工时直接当成现金回收，识别重复计量、实施前提、敏感性、下行情景和退出条件。",
      "Compare the baseline with feasible options, separating initial and recurring costs, incremental benefits and cash timing. Use approved valuation assumptions, avoid double counting and analyze sensitivity, downside and exit conditions.",
    ],
    design: [
      "工作簿分设基线、输入假设、投入与收益明细、期间计算、情景比较和核对说明，所有金额标注币种和单位。以清晰标签区分预测、已批准和实际发生，输入与公式分开；决策摘要只展示关键结果及对应的来源与假设。",
      "Separate the baseline, assumptions, cost and benefit detail, periodic calculations, scenarios and reconciliation. Label currency, assumptions, approvals and actuals, and provide an evidence-linked decision summary.",
    ],
    checks: [
      "检查现金流发生期间、成本边界、贴现或回收计算口径，核对汇总与明细以及乐观保守情景的假设差异。重大法律、税务与会计处理由专业人员确认；公式未重算或收益未经验证时应明确披露，不将测算作为投资批准。",
      "Review cash timing, cost scope, valuation assumptions, scenario differences and reconciliation. Refer legal, tax and accounting treatment to qualified reviewers; disclose unverified formulas and benefits.",
    ],
  },
  "product-spec": {
    inputs: [
      "收集用户任务、业务目标、现有流程、研究证据、问题反馈、约束和相关系统接口。核对使用人群、权限、设备、数据来源与发布范围；未经验证的用户需求、性能目标和历史行为应标记假设，避免将解决方案直接当作用户事实。",
      "Gather user jobs, business goals, existing workflows, research evidence, feedback, constraints and interfaces. Verify audience, permissions and data sources; label untested needs or targets as assumptions.",
    ],
    method: [
      "先界定问题、目标与不做范围，再描述用户流程、系统行为、数据和权限边界。对每项需求写明触发条件、正常结果、空态、失败、恢复与验收证据；记录依赖、迁移影响、衡量方法和需要产品或工程负责人确认的问题。",
      "Define the problem, goals and exclusions, then specify workflows, system behavior, data and permissions. Cover triggers, normal, empty, failure and recovery states, acceptance evidence, dependencies and migration.",
    ],
    design: [
      "首页列目标、受众、版本和状态，正文按用户任务和功能范围分节；用步骤表或状态矩阵清晰对应触发、行为、反馈和异常。设计图或原型仅在有真实来源时引用，保持术语、编号与验收条目一致，便于产品和工程共同审阅。",
      "Show goal, audience, version and status up front; organize by user task and scope. Use flow and state matrices mapping triggers to behavior, feedback and exceptions, referencing only real designs.",
    ],
    checks: [
      "逐项检查需求是否有来源、用户价值和可观察的验收条件，边界状态、权限和数据迁移是否遗漏。识别矛盾、不可测要求、未批准依赖及真实未验证项；文档评审不等同于功能已实现、测试通过或发布获批。",
      "Check each requirement for evidence, user value and observable acceptance, including boundary states, permissions and migration. Flag contradictions and unapproved dependencies; a specification is not proof of implementation.",
    ],
  },
  "ux-research": {
    inputs: [
      "收集研究要支持的产品决定、目标人群、已有证据、研究问题、招募标准及现有原型或工作流程。确认参与者同意、记录方式、资料保留和可见范围；无法获得代表性样本或相关资料时列为方法限制，不补造引语。",
      "Gather the product decision, target users, prior evidence, research questions, recruitment criteria and prototype or workflow. Verify consent, recording and retention, and disclose sampling or evidence gaps.",
    ],
    method: [
      "根据研究问题选择访谈、观察或可用性任务，明确招募条件、任务成功标准和记录方式。将原始观察、参与者原话、研究者解释与设计建议分开，保留失败路径和反例；小样本发现不能直接推断总体比例或因果关系。",
      "Choose interviews, observation or usability tasks based on the question; define recruitment and success criteria. Separate observations, quotes, interpretations and recommendations, retaining failures and sample limits.",
    ],
    design: [
      "用研究目的、方法、样本概览、关键发现、证据、机会与后续验证组织报告；每项发现附匿名化证据位置和适用范围。优先以可扫描的表格或任务流程表达结果，个人身份、联系方式和未经授权的截图不进入分发版本。",
      "Organize purpose, methods, sample, findings, evidence, opportunities and next validation. Link findings to appropriately anonymized evidence and exclude unauthorized identities or screenshots from shared copies.",
    ],
    checks: [
      "核对研究问题、样本、任务、引语与原始记录，检查是否有引导性提问、研究者提示或遗漏的反例。确认匿名化不暴露可识别组合信息；未实施访谈、未征得同意或未完成验证时如实披露，不凭报告声称产品体验已改善。",
      "Verify questions, sample, tasks and quotations against records; review prompting bias and counterexamples. Check re-identification risk and disclose interviews, consent or validation that did not occur.",
    ],
  },
  "release-readiness": {
    inputs: [
      "收集候选版本、变更范围、实际构建标识、测试与缺陷记录、部署环境、监控、值守及发布审批要求。核对受影响客户、依赖版本、备份和回退材料；没有测试日志或审批证据的项目保持未知，不以计划或口头描述充当结果。",
      "Gather the candidate build, change scope, test and defect records, environments, monitoring, support and approval requirements. Verify dependencies and recovery evidence without substituting plans for results.",
    ],
    method: [
      "按版本和环境逐项对照功能、安全、数据迁移、兼容性、支持准备及已知风险，区分阻塞、可接受风险和未验证事项。写明发布决策人、观察窗口、暂停条件与回退责任；只有真实演练或测试证据才能用于宣称验证通过。",
      "Assess function, security, migration, compatibility and support by build and environment. Separate blockers, accepted risks and unknowns; define the release authority, observation window, stop conditions and rollback owner.",
    ],
    design: [
      "首页给出候选版本、当前就绪状态、重大阻塞和需要的裁决，使用检查表记录项目、证据、负责人、日期及状态。将执行步骤、监控和应急联系分节，避免仅靠颜色表达通过或失败，并为环境与构建标识保留明确位置。",
      "Show candidate build, readiness, blockers and the decision required. Use a checklist with evidence, owners, dates and textual states, plus separate deployment, monitoring and escalation sections.",
    ],
    checks: [
      "核对所有测试记录是否对应同一候选构建与目标环境，确认跳过项、失败项和风险接受有真实责任人。备份、回退、升级与监控未执行时不得标通过；复核文档中的版本号、状态、链接及实际渲染检查结果。",
      "Match evidence to the candidate build and target environment, including skips, failures and risk owners. Do not mark backup, rollback, upgrade or monitoring passed without execution evidence.",
    ],
  },
  "architecture-decision": {
    inputs: [
      "收集待决定的问题、业务和技术约束、现有系统边界、调用方、数据流、可靠性目标及候选方案。核对实际接口、版本、团队维护能力、安全要求和迁移成本；对尚未测量的性能、预算和故障恢复能力注明未知。",
      "Gather the decision problem, constraints, current boundaries, callers, data flows, reliability targets and candidate options. Verify interfaces, versions, maintenance capacity and unknown performance or recovery evidence.",
    ],
    method: [
      "先定义不可破坏的安全、兼容和数据不变量，再列出可行选项与维持现状的后果。针对复杂度、故障模式、运维、迁移、成本和可逆性比较权衡，记录拒绝其他方案的理由、承担的后果及触发重新评估的条件。",
      "Define security, compatibility and data invariants, then compare options and the status quo for complexity, failure modes, operations, migration, cost and reversibility. Record rejected options and review triggers.",
    ],
    design: [
      "以决策标题、状态、日期与负责人开篇，随后用背景、约束、方案、决定、后果和复审条件构成稳定结构。用简洁对照表或经授权的系统关系图解释关键差异，接口和数据流保留准确名称，不把建议状态排成已实施。",
      "Start with the decision title, status, date and owner; structure context, constraints, options, decision, consequences and review triggers. Use accurate interfaces and clearly label proposed work.",
    ],
    checks: [
      "确认方案比较基于同一约束和证据，检查安全边界、失败恢复、可观测性、兼容迁移及责任是否已讨论。架构图与实际接口不一致时标记待确认；未经验证的方案不得声称满足性能目标，尚未批准的记录保留提议状态。",
      "Check options against common constraints and evidence, including security, recovery, observability, compatibility and ownership. Flag diagram mismatches and do not claim untested performance or approval.",
    ],
  },
  "onboarding-program": {
    inputs: [
      "收集入职角色、职责、联系人、经授权的流程资料、岗位能力目标、设备与系统申请方式、导师资源及关键日期。确认适用制度版本和必要授权，敏感员工资料只保留完成安排所需的最少内容，不复制证件或真实凭据。",
      "Gather role, responsibilities, contacts, authorized procedures, capability objectives, access-request processes, mentor capacity and key dates. Minimize sensitive employee data and never copy identity documents or credentials unnecessarily.",
    ],
    method: [
      "按入职前、首日、首周和后续阶段安排学习、实践、交接与反馈，分别列明员工、经理、导师及支持团队责任。每个阶段设可观察的结果和检查点；系统账号、岗位授权与学习进度须依据真实状态分别确认。",
      "Sequence preparation, first day, first week and later learning, practice and feedback. Assign responsibilities and observable checkpoints; verify account access, job authorization and learning progress separately.",
    ],
    design: [
      "用时间表展示阶段目标、任务、负责人、截止时间和完成证据，再按主题补充联系人、资料入口和求助渠道。对管理者内部准备和员工可见材料明确分区，链接仅使用真实地址，未确认的事项保留待办状态。",
      "Use a timeline of outcomes, tasks, owners, dates and evidence, with real resource links and support contacts. Separate manager-only preparation from employee-facing materials and keep unknown tasks open.",
    ],
    checks: [
      "核实时间顺序、联系人、导师负载和各阶段任务与岗位目标的对应关系，检查新员工是否知道如何求助。账号、设备、资料权限与培训结果需分别取得证据；未实际开通或确认的事项不能写为已完成，必要时请负责人复核。",
      "Check timing, contacts, mentor capacity, role alignment and support channels. Require separate evidence for access, equipment and training; do not mark unconfirmed setup complete.",
    ],
  },
  "performance-review": {
    inputs: [
      "收集已约定的评价周期、岗位职责、目标与权重、可核实工作成果、反馈记录和员工提供的背景。确认评价者权限、资料来源与共享范围；缺失证据和目标变更须列明，不收集与工作无关的敏感个人信息。",
      "Gather agreed review periods, responsibilities, goals, weights, verifiable outcomes, feedback and employee context. Confirm reviewer authorization and sharing scope; flag missing evidence without collecting irrelevant sensitive data.",
    ],
    method: [
      "对照事先约定的目标和岗位要求讨论结果、具体行为、环境变化与支持条件，区分团队成果和个人贡献。保留员工补充和不同意见，识别发展机会并形成可执行练习、支持资源及复查时间；不根据性格或敏感属性推断表现。",
      "Review results and observable behavior against agreed goals, context and resources, distinguishing individual from team outcomes. Preserve employee input and create development actions without inferring performance from sensitive traits.",
    ],
    design: [
      "文档按目标、事实证据、成果与障碍、员工观点、发展行动及复查组织，表格列出证据来源和评价时间。使用尊重且具体的措辞，避免标签化；分发版本仅保留必要资料，访问控制由用户在受控位置另行配置。",
      "Organize goals, evidence, outcomes, employee views, development actions and review dates. Use specific respectful language, minimize shared data and have users configure access separately in a controlled location.",
    ],
    checks: [
      "核对周期、目标版本、证据与评价结论是否对应，检查是否混淆结果和潜力、遗漏背景或用抽象标签替代事实。员工意见和争议保留待讨论状态；晋升、薪酬及人事决定必须由授权人员确认，文件生成不等于审批完成。",
      "Match conclusions to the correct goals, period and evidence, reviewing context and employee disagreements. Require authorized decisions on promotion, pay and employment; generating a document is not approval.",
    ],
  },
  "incident-review": {
    inputs: [
      "收集事件编号、影响范围、告警与日志、变更记录、响应沟通、恢复证据及当前未决问题。统一时间来源与时区，标记记录缺口、敏感信息及可见范围；若证据不足，不能根据发生时间或参与人推定根因和责任。",
      "Gather incident identifiers, impact, alerts, logs, changes, response communications and recovery evidence. Align time sources and time zones, flag gaps and sensitivity, and do not infer cause or blame from timing alone.",
    ],
    method: [
      "建立从发生、发现、缓解到恢复和验证的时间线，区分已证实事实、假设和未知项，并说明每个重要时间点所依据的记录。分析触发事件、系统条件、检测盲区及控制失效，将纠正措施关联责任人、期限和复验方式；坚持无责复盘并保留反证。",
      "Build a timeline from occurrence and detection through mitigation, recovery and validation, citing the records behind key times. Separate facts, hypotheses and unknowns; analyze systemic conditions and assign corrective actions and verification without blame.",
    ],
    design: [
      "首页说明事件状态、影响和当前结论，正文以时间线、影响表、因果分析和行动清单呈现。对需要继续调查的内容使用明确文字状态，证据链接和敏感日志只在授权范围内引用；避免将临时推断以视觉强调误写成确定根因。",
      "Present status, impact and current findings first, followed by timeline, causal analysis and action tracking. Label ongoing investigations and restrict evidence references to authorized material.",
    ],
    checks: [
      "核对时间顺序、时区、影响统计口径与原始记录，检查根因是否有证据、纠正措施是否能降低风险并具有复验责任。尚未确认的影响和恢复情况不得写为零或已解决；检查文档敏感信息及实际分页、渲染状态。",
      "Verify chronology, time zones, impact definitions and causal evidence, and ensure actions have owners and retest criteria. Unknown impact or recovery must not be reported as zero or resolved.",
    ],
  },
  "governance-review": {
    inputs: [
      "收集评审授权、适用标准、治理职责、风险登记、控制设计、执行记录和整改证据。明确评审期间、组织范围、样本来源、访问授权及独立性限制；缺少制度、样本或负责人反馈时保留证据缺口，不能虚构审计结论。",
      "Gather review authority, criteria, responsibilities, risks, controls, execution records and remediation evidence. State period, scope, sampling, access and independence limits without inventing assurance.",
    ],
    method: [
      "以风险和控制目标确定评审范围与样本，将每项发现按适用标准、实际情况、证据、影响和可能原因整理。区别控制设计与执行有效性，结合补偿措施和责任人意见提出整改或风险接受建议，不将抽样结果外推为全面通过。",
      "Select scope and samples from risks and control objectives. Record criterion, condition, evidence, impact and cause; distinguish design from operating effectiveness and do not extrapolate samples to full assurance.",
    ],
    design: [
      "报告首页列范围、期间、主要发现及限制，正文用发现编号对应控制、证据、风险等级、责任、整改期限与复验状态。将抽样明细和适用标准放入附录，敏感材料最小化引用，权限和共享由授权人员在受控位置配置。",
      "Show scope, period, findings and limits first; link each finding to controls, evidence, risk, owner, remediation and retest. Put samples in an appendix and have authorized people manage access separately.",
    ],
    checks: [
      "复核每项发现是否有适用标准、可追溯证据、受评方事实反馈与合理风险依据，检查整改是否具有责任人和复验条件。未取得授权、未抽到的范围及未完成复验必须标示限制；报告草案不等于正式审计意见或整改关闭。",
      "Verify that findings have criteria, traceable evidence, factual feedback and risk rationale; require remediation ownership and retest. Disclose unreviewed scope and do not treat a draft as a formal audit opinion.",
    ],
  },
};
