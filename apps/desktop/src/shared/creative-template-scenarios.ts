interface LocalizedText {
  zh: string;
  en: string;
}

export interface CreativeScenarioGroup {
  audience: LocalizedText;
  acceptance: LocalizedText;
  scenarios: ReadonlyArray<LocalizedText>;
}

const group = (
  audience: [string, string],
  acceptance: [string, string],
  scenarios: ReadonlyArray<[string, string]>,
): CreativeScenarioGroup => ({
  audience: { zh: audience[0], en: audience[1] },
  acceptance: { zh: acceptance[0], en: acceptance[1] },
  scenarios: scenarios.map(([zh, en]) => ({ zh, en })),
});

// The order of each family's 12 scenarios is tied to the legacy variant IDs.
export const CREATIVE_FAMILY_SCENARIOS: Readonly<
  Record<string, ReadonlyArray<CreativeScenarioGroup>>
> = {
  "decision-deck": [
    group(
      ["业务负责人和项目发起人", "Business leaders and project sponsors"],
      [
        "明确立项或调整所需资源、预期结果和不实施的代价",
        "Specify resources, expected outcomes, and the cost of not proceeding",
      ],
      [
        ["项目立项", "Project initiation"],
        ["项目扩容", "Project expansion"],
        ["项目暂停", "Project pause"],
        ["资源重新分配", "Resource reallocation"],
      ],
    ),
    group(
      ["产品、运营和财务决策人", "Product, operations, and finance decision makers"],
      [
        "对照业务基线说明候选方案的收益、成本与主要假设",
        "Compare benefits, costs, and assumptions against the business baseline",
      ],
      [
        ["定价调整", "Pricing change"],
        ["市场进入", "Market entry"],
        ["供应商选择", "Supplier selection"],
        ["渠道组合调整", "Channel mix change"],
      ],
    ),
    group(
      ["治理委员会和风险负责人", "Governance board and risk owners"],
      [
        "写明决策权限、风险触发信号和复审日期",
        "State decision authority, risk triggers, and a review date",
      ],
      [
        ["风险处置", "Risk treatment"],
        ["例外审批", "Exception approval"],
        ["业务连续性投入", "Business continuity investment"],
        ["重大变更授权", "Major change authorization"],
      ],
    ),
  ],
  "company-narrative": [
    group(
      ["潜在客户与合作伙伴", "Prospective customers and partners"],
      [
        "用经授权的真实案例证明用户问题与价值",
        "Support the user problem and value with authorized real examples",
      ],
      [
        ["公司介绍", "Company introduction"],
        ["客户初次会面", "First client meeting"],
        ["合作伙伴介绍", "Partner introduction"],
        ["行业活动演讲", "Industry event talk"],
      ],
    ),
    group(
      ["候选人和新加入成员", "Candidates and new team members"],
      [
        "具体说明使命如何体现在产品和工作方式中，避免未经证实的文化承诺",
        "Show how the mission appears in product and work, without unsupported culture claims",
      ],
      [
        ["招聘宣讲", "Recruiting presentation"],
        ["新人欢迎", "New hire welcome"],
        ["校园介绍", "Campus introduction"],
        ["团队使命分享", "Team mission briefing"],
      ],
    ),
    group(
      ["现有员工和公司管理团队", "Employees and company leadership"],
      [
        "区分已完成里程碑与未来目标，并说明下一阶段的重点",
        "Separate achieved milestones from future goals and identify the next priorities",
      ],
      [
        ["年度回顾", "Annual company review"],
        ["战略转型说明", "Strategic transition"],
        ["公司里程碑", "Company milestones"],
        ["内部愿景对齐", "Internal vision alignment"],
      ],
    ),
  ],
  "product-launch": [
    group(
      ["产品、工程和支持团队", "Product, engineering, and support teams"],
      [
        "列出发布依赖、验证状态、负责人和停止条件",
        "List launch dependencies, verification status, owners, and stop conditions",
      ],
      [
        ["新功能首发", "New feature launch"],
        ["版本升级", "Version upgrade"],
        ["有限试点", "Limited pilot"],
        ["分阶段开放", "Phased rollout"],
      ],
    ),
    group(
      ["市场、销售和渠道团队", "Marketing, sales, and channel teams"],
      [
        "将用户价值与已验证能力对应，并安排渠道素材和发布时间",
        "Map user value to verified capability and schedule channel assets",
      ],
      [
        ["新品发布", "New product release"],
        ["新市场发布", "New market launch"],
        ["合作伙伴发布", "Partner launch"],
        ["产品组合更新", "Portfolio update"],
      ],
    ),
    group(
      [
        "现有客户、实施与客户成功团队",
        "Existing customers, implementation, and customer success teams",
      ],
      [
        "说明用户影响、迁移或启用步骤以及支持渠道",
        "Explain user impact, migration or activation steps, and support channels",
      ],
      [
        ["功能迁移", "Feature migration"],
        ["服务替换", "Service replacement"],
        ["默认设置变更", "Default setting change"],
        ["客户分批升级", "Customer upgrade waves"],
      ],
    ),
  ],
  "training-deck": [
    group(
      ["新员工和带教人员", "New hires and onboarding instructors"],
      [
        "提供新成员能完成的实操任务与反馈标准",
        "Provide a practical task and feedback criteria for new hires",
      ],
      [
        ["新员工培训", "New hire training"],
        ["岗位基础培训", "Role fundamentals"],
        ["工作流程培训", "Workflow training"],
        ["工具上手培训", "Tool onboarding"],
      ],
    ),
    group(
      ["一线执行人员和讲师", "Frontline practitioners and instructors"],
      [
        "练习应覆盖正常操作、常见错误和纠正反馈",
        "Practice covers normal operation, common mistakes, and corrective feedback",
      ],
      [
        ["服务技能培训", "Service skills training"],
        ["安全操作培训", "Safe operations training"],
        ["质量检查培训", "Quality inspection training"],
        ["客户沟通培训", "Customer communication training"],
      ],
    ),
    group(
      ["团队负责人和在岗学习者", "Team leads and working learners"],
      [
        "以真实工作任务检验迁移，并说明课后跟进方式",
        "Assess transfer through a real work task and specify follow-up",
      ],
      [
        ["管理技能培训", "Management skills training"],
        ["跨团队协作培训", "Cross-team collaboration training"],
        ["辅导反馈培训", "Coaching and feedback training"],
        ["问题解决培训", "Problem-solving training"],
      ],
    ),
  ],
  "project-kickoff": [
    group(
      ["项目发起人、项目经理和交付团队", "Project sponsors, project managers, and delivery teams"],
      [
        "明确授权、范围边界和首个里程碑的完成定义",
        "State authorization, scope boundaries, and the first milestone's definition of done",
      ],
      [
        ["新项目启动", "New project kickoff"],
        ["项目二期启动", "Project phase-two kickoff"],
        ["内部改进项目", "Internal improvement kickoff"],
        ["研究项目启动", "Research project kickoff"],
      ],
    ),
    group(
      ["跨团队负责人和依赖方", "Cross-team leads and dependency owners"],
      [
        "每个跨团队依赖写明交付物、责任人和时间",
        "Name the deliverable, owner, and timing of each cross-team dependency",
      ],
      [
        ["跨部门协作", "Cross-department collaboration"],
        ["系统集成启动", "System integration kickoff"],
        ["流程变更启动", "Process change kickoff"],
        ["联合交付启动", "Joint delivery kickoff"],
      ],
    ),
    group(
      ["客户、供应商和交付负责人", "Customers, suppliers, and delivery leads"],
      [
        "区分双方职责、验收节点及变更升级路径",
        "Separate each party's responsibilities, acceptance gates, and change escalation",
      ],
      [
        ["客户实施启动", "Client implementation kickoff"],
        ["供应商引入", "Supplier onboarding kickoff"],
        ["外包交付启动", "Outsourced delivery kickoff"],
        ["联合试点启动", "Joint pilot kickoff"],
      ],
    ),
  ],
  "client-proposal": [
    group(
      ["潜在客户的业务负责人和采购人员", "Prospective client business and procurement leads"],
      [
        "需求、范围、报价假设与验收方式保持一致",
        "Align needs, scope, pricing assumptions, and acceptance",
      ],
      [
        ["咨询服务提案", "Consulting services proposal"],
        ["项目实施提案", "Implementation proposal"],
        ["运营支持提案", "Operations support proposal"],
        ["培训服务提案", "Training services proposal"],
      ],
    ),
    group(
      ["现有客户和客户成功负责人", "Existing clients and customer success leads"],
      [
        "基于已有合作证据说明变更范围及新增价值",
        "Use existing engagement evidence to explain changed scope and incremental value",
      ],
      [
        ["续约提案", "Renewal proposal"],
        ["服务扩展提案", "Service expansion proposal"],
        ["项目二期提案", "Second-phase proposal"],
        ["服务调整提案", "Service adjustment proposal"],
      ],
    ),
    group(
      ["合作伙伴和联合方案评审方", "Partners and joint-solution reviewers"],
      [
        "明确双方分工、共享依赖及对外承诺的审批边界",
        "Define each party's work, shared dependencies, and approval of external commitments",
      ],
      [
        ["渠道合作提案", "Channel partnership proposal"],
        ["联合解决方案", "Joint solution proposal"],
        ["试点合作提案", "Pilot partnership proposal"],
        ["供应商合作提案", "Supplier partnership proposal"],
      ],
    ),
  ],
  "strategy-brief": [
    group(
      ["公司管理层和战略负责人", "Company leadership and strategy owners"],
      [
        "明确战略选择、放弃事项和资源配置",
        "State the strategic choice, what is not pursued, and resource allocation",
      ],
      [
        ["年度战略", "Annual strategy"],
        ["业务聚焦", "Business focus"],
        ["增长路径", "Growth path"],
        ["业务转型", "Business transformation"],
      ],
    ),
    group(
      ["业务部门负责人和执行团队", "Business unit leaders and delivery teams"],
      [
        "将战略转化为阶段行动、责任人和衡量指标",
        "Translate strategy into phased actions, owners, and measures",
      ],
      [
        ["市场拓展", "Market expansion"],
        ["客户留存", "Customer retention"],
        ["产品组合", "Product portfolio"],
        ["渠道发展", "Channel development"],
      ],
    ),
    group(
      ["职能负责人和治理团队", "Functional leaders and governance teams"],
      [
        "说明能力缺口、风险信号和调整条件",
        "Describe capability gaps, risk signals, and conditions for adjustment",
      ],
      [
        ["技术能力建设", "Technology capability"],
        ["人才发展", "Talent development"],
        ["运营效率", "Operational efficiency"],
        ["风险治理", "Risk governance"],
      ],
    ),
  ],
  "project-charter": [
    group(
      ["项目发起人和项目经理", "Project sponsor and project manager"],
      [
        "列出授权人、项目成果、排除范围和签署条件",
        "List the authorizer, outcomes, exclusions, and sign-off conditions",
      ],
      [
        ["新项目授权", "New project authorization"],
        ["项目扩展授权", "Project expansion authorization"],
        ["项目重启授权", "Project restart authorization"],
        ["试点项目授权", "Pilot project authorization"],
      ],
    ),
    group(
      ["跨部门负责人和项目治理组", "Cross-functional leads and project governance"],
      [
        "写明决策权、关键依赖和争议升级路径",
        "State decision rights, critical dependencies, and escalation",
      ],
      [
        ["跨部门项目", "Cross-functional project"],
        ["流程改造项目", "Process redesign project"],
        ["系统集成项目", "System integration project"],
        ["组织变更项目", "Organizational change project"],
      ],
    ),
    group(
      ["客户代表、交付方和验收人", "Client representatives, delivery team, and acceptors"],
      [
        "双方责任、交付物和验收证据必须相互对应",
        "Map each party's responsibilities to deliverables and acceptance evidence",
      ],
      [
        ["客户实施项目", "Client implementation project"],
        ["联合研究项目", "Joint research project"],
        ["供应商交付项目", "Supplier delivery project"],
        ["合作试点项目", "Partnership pilot project"],
      ],
    ),
  ],
  "policy-playbook": [
    group(
      ["制度所有者和全体适用人员", "Policy owners and affected staff"],
      [
        "明确适用范围、强制要求、例外审批和记录保留",
        "Specify applicability, mandatory rules, exception approval, and records",
      ],
      [
        ["信息分类制度", "Information classification policy"],
        ["资料保留制度", "Records retention policy"],
        ["内部沟通制度", "Internal communications policy"],
        ["远程办公制度", "Remote work policy"],
      ],
    ),
    group(
      ["人力资源、经理和员工", "People operations, managers, and employees"],
      [
        "区分员工和管理者责任，并提供可申诉或升级的渠道",
        "Distinguish employee and manager duties and provide an escalation or appeal path",
      ],
      [
        ["招聘制度", "Recruitment policy"],
        ["员工入职制度", "Employee onboarding policy"],
        ["培训管理制度", "Training management policy"],
        ["利益冲突申报", "Conflict-of-interest disclosure"],
      ],
    ),
    group(
      ["运营、采购与合规负责人", "Operations, procurement, and compliance owners"],
      [
        "定义控制责任、审批权限和例外证据，不虚构法律要求",
        "Define control ownership, approvals, and exception evidence without inventing legal requirements",
      ],
      [
        ["采购审批制度", "Procurement approval policy"],
        ["供应商管理制度", "Supplier management policy"],
        ["支出授权制度", "Spending authorization policy"],
        ["访问权限制度", "Access control policy"],
      ],
    ),
  ],
  sop: [
    group(
      ["一线操作人员和班组负责人", "Frontline operators and team leads"],
      [
        "步骤写明输入、操作、检查结果和安全停止条件",
        "Give each step its input, action, check, and safe stop condition",
      ],
      [
        ["设备日常检查", "Routine equipment inspection"],
        ["交接班", "Shift handover"],
        ["现场巡检", "Site inspection"],
        ["质量抽检", "Quality sampling"],
      ],
    ),
    group(
      ["服务团队和支持主管", "Service teams and support supervisors"],
      [
        "覆盖正常办理、异常升级和交接记录",
        "Cover normal handling, exception escalation, and handover records",
      ],
      [
        ["客户请求处理", "Customer request handling"],
        ["投诉受理", "Complaint intake"],
        ["服务交付检查", "Service delivery check"],
        ["工单交接", "Ticket handover"],
      ],
    ),
    group(
      ["运营人员和流程负责人", "Operations staff and process owners"],
      [
        "说明所需授权、核对点、失败恢复和留存证据",
        "State required authority, checks, failure recovery, and retained evidence",
      ],
      [
        ["采购申请", "Purchase request"],
        ["供应商开通", "Supplier setup"],
        ["报表发布", "Report publication"],
        ["资料归档", "Records archiving"],
      ],
    ),
  ],
  "research-report": [
    group(
      ["研究委托方和业务决策者", "Research sponsors and business decision makers"],
      [
        "结论对应具体问题、证据来源和方法局限",
        "Connect findings to the question, sources, and methodological limits",
      ],
      [
        ["市场规模研究", "Market sizing study"],
        ["行业趋势研究", "Industry trends study"],
        ["竞争格局研究", "Competitive landscape study"],
        ["政策环境研究", "Policy environment study"],
      ],
    ),
    group(
      ["研究团队和学术或专业评审者", "Research teams and academic or professional reviewers"],
      [
        "说明样本、分析方法、反证和可复核来源",
        "Describe sample, analysis method, counterevidence, and reviewable sources",
      ],
      [
        ["文献综述", "Literature review"],
        ["案例比较", "Comparative case study"],
        ["问卷研究", "Survey study"],
        ["访谈研究", "Interview study"],
      ],
    ),
    group(
      ["产品、运营与服务负责人", "Product, operations, and service leaders"],
      [
        "区分观察与推断，并说明发现能支持的具体决策",
        "Separate observations from inference and state which decision the findings support",
      ],
      [
        ["客户需求研究", "Customer needs study"],
        ["服务质量研究", "Service quality study"],
        ["用户流失研究", "User churn study"],
        ["渠道效果研究", "Channel effectiveness study"],
      ],
    ),
  ],
  "technical-evaluation": [
    group(
      ["架构师、工程负责人和运维人员", "Architects, engineering leads, and operators"],
      [
        "比较候选方案的部署、维护、故障处理和迁移成本",
        "Compare deployment, maintenance, failure handling, and migration costs",
      ],
      [
        ["数据库选型", "Database selection"],
        ["消息系统选型", "Messaging system selection"],
        ["部署平台选型", "Deployment platform selection"],
        ["存储方案选型", "Storage solution selection"],
      ],
    ),
    group(
      ["工程团队和性能评审人员", "Engineering teams and performance reviewers"],
      [
        "性能结果必须记录负载、环境、方法及异常值",
        "Performance results must identify workload, environment, method, and outliers",
      ],
      [
        ["性能基准评估", "Performance benchmark"],
        ["扩容方案评估", "Scaling evaluation"],
        ["缓存方案评估", "Caching evaluation"],
        ["批处理方案评估", "Batch processing evaluation"],
      ],
    ),
    group(
      ["安全、工程和采购评审人员", "Security, engineering, and procurement reviewers"],
      [
        "逐项说明权限、数据边界、依赖风险和未验证项",
        "Specify permissions, data boundaries, dependency risks, and unverified items",
      ],
      [
        ["第三方依赖评估", "Third-party dependency evaluation"],
        ["身份认证方案评估", "Authentication solution evaluation"],
        ["供应商技术评估", "Vendor technology evaluation"],
        ["日志平台评估", "Logging platform evaluation"],
      ],
    ),
  ],
  "meeting-brief": [
    group(
      ["会议参与者和行动负责人", "Meeting participants and action owners"],
      [
        "决定和行动项分别标明负责人、截止时间及待确认状态",
        "Identify owners, due dates, and pending status for decisions and actions",
      ],
      [
        ["项目例会", "Project status meeting"],
        ["团队周会", "Team weekly meeting"],
        ["跨部门同步", "Cross-functional sync"],
        ["工作交接会议", "Work handover meeting"],
      ],
    ),
    group(
      ["决策者和受影响团队", "Decision makers and affected teams"],
      [
        "记录决策依据、反对意见和未决问题，不把讨论当成批准",
        "Record rationale, objections, and open questions without treating discussion as approval",
      ],
      [
        ["方案评审会议", "Proposal review meeting"],
        ["预算评审会议", "Budget review meeting"],
        ["风险评审会议", "Risk review meeting"],
        ["变更决策会议", "Change decision meeting"],
      ],
    ),
    group(
      ["客户、合作伙伴及双方负责人", "Customers, partners, and accountable leads"],
      [
        "只记录已确认的双方承诺，并保留确认与跟进方式",
        "Record only confirmed mutual commitments and the confirmation and follow-up process",
      ],
      [
        ["客户需求会议", "Client requirements meeting"],
        ["供应商沟通会议", "Supplier meeting"],
        ["合作方案会议", "Partnership meeting"],
        ["交付验收会议", "Delivery acceptance meeting"],
      ],
    ),
  ],
  "brand-campaign": [
    group(
      ["品牌、创意和传播团队", "Brand, creative, and communications teams"],
      [
        "核心创意应连接受众洞察、品牌证据与渠道表达",
        "Connect the creative idea to audience insight, brand proof, and channel execution",
      ],
      [
        ["品牌认知战役", "Brand awareness campaign"],
        ["品牌定位更新", "Brand positioning update"],
        ["品牌周年活动", "Brand anniversary campaign"],
        ["品牌故事传播", "Brand story campaign"],
      ],
    ),
    group(
      ["市场、产品和渠道团队", "Marketing, product, and channel teams"],
      [
        "说明目标受众、真实产品价值、素材权利和衡量方式",
        "State the audience, real product value, asset rights, and measurement",
      ],
      [
        ["新品传播战役", "New product campaign"],
        ["季节推广战役", "Seasonal campaign"],
        ["会员增长战役", "Membership growth campaign"],
        ["区域市场战役", "Regional market campaign"],
      ],
    ),
    group(
      ["社区、合作伙伴和公关团队", "Community, partner, and public relations teams"],
      [
        "公开主张、合作方责任和敏感问题回应须可核验",
        "Make public claims, partner responsibilities, and sensitive responses verifiable",
      ],
      [
        ["社区参与战役", "Community participation campaign"],
        ["合作伙伴联动", "Partner activation"],
        ["公益主题传播", "Public-interest campaign"],
        ["活动传播战役", "Event communications campaign"],
      ],
    ),
  ],
  "poster-campaign": [
    group(
      ["活动组织者和潜在参与者", "Event organizers and prospective attendees"],
      [
        "活动名称、时间、地点和报名方式清晰可读",
        "Make the event name, time, location, and registration method legible",
      ],
      [
        ["讲座活动海报", "Lecture poster"],
        ["展览活动海报", "Exhibition poster"],
        ["工作坊海报", "Workshop poster"],
        ["社区活动海报", "Community event poster"],
      ],
    ),
    group(
      ["品牌团队和目标受众", "Brand teams and target audiences"],
      [
        "主张与素材授权可核实，行动信息不被视觉遮挡",
        "Verify claims and asset rights; keep the call to action unobstructed",
      ],
      [
        ["新品介绍海报", "Product introduction poster"],
        ["品牌故事海报", "Brand story poster"],
        ["会员活动海报", "Membership event poster"],
        ["门店活动海报", "Store event poster"],
      ],
    ),
    group(
      ["组织内部发布者和阅读者", "Internal publishers and readers"],
      [
        "关键信息、负责部门和适用时间一目了然",
        "Make key information, responsible team, and effective dates clear",
      ],
      [
        ["招聘信息海报", "Recruitment poster"],
        ["内部培训海报", "Internal training poster"],
        ["安全提醒海报", "Safety reminder poster"],
        ["项目公告海报", "Project announcement poster"],
      ],
    ),
  ],
  "social-campaign": [
    group(
      ["社媒编辑与社区运营人员", "Social editors and community managers"],
      [
        "每条内容标明平台、发布节奏、事实来源和互动处理方式",
        "Identify platform, cadence, factual sources, and engagement handling for each post",
      ],
      [
        ["栏目连载", "Editorial series"],
        ["社区问答", "Community Q&A"],
        ["幕后故事", "Behind-the-scenes series"],
        ["用户故事", "User story series"],
      ],
    ),
    group(
      ["产品市场与内容制作团队", "Product marketing and content teams"],
      [
        "产品主张对应已验证能力，平台格式与行动目标明确",
        "Tie product claims to verified capability and specify platform format and action",
      ],
      [
        ["新品内容计划", "New product content plan"],
        ["功能介绍系列", "Feature introduction series"],
        ["活动预热", "Event preview series"],
        ["客户案例系列", "Customer case series"],
      ],
    ),
    group(
      ["品牌、公关和客户支持人员", "Brand, PR, and customer support teams"],
      [
        "明确敏感话题的回应边界、审核人和升级路径",
        "Define response boundaries, reviewers, and escalation for sensitive topics",
      ],
      [
        ["品牌观点系列", "Brand viewpoint series"],
        ["公共信息更新", "Public information updates"],
        ["服务变更通知", "Service change announcements"],
        ["活动后续回顾", "Post-event recap series"],
      ],
    ),
  ],
  "lesson-plan": [
    group(
      ["基础教育教师和学生", "School teachers and students"],
      [
        "活动时长、学生练习和课堂检查应对应学习目标",
        "Align activity timing, student practice, and classroom checks with outcomes",
      ],
      [
        ["新知识导入课", "New concept lesson"],
        ["知识巩固课", "Consolidation lesson"],
        ["课堂练习课", "Practice lesson"],
        ["单元复习课", "Unit review lesson"],
      ],
    ),
    group(
      ["职业培训讲师和学员", "Vocational instructors and learners"],
      [
        "示范与练习覆盖操作步骤、常见错误和反馈",
        "Cover steps, common errors, and feedback in demonstrations and practice",
      ],
      [
        ["岗位技能课", "Job skills lesson"],
        ["操作演示课", "Procedure demonstration lesson"],
        ["安全培训课", "Safety training lesson"],
        ["情境模拟课", "Scenario simulation lesson"],
      ],
    ),
    group(
      ["培训导师和成人学习者", "Trainers and adult learners"],
      [
        "说明学员基础、工作情境、迁移任务及达标证据",
        "State prior knowledge, work context, transfer task, and evidence of mastery",
      ],
      [
        ["沟通技能课", "Communication skills lesson"],
        ["问题解决课", "Problem-solving lesson"],
        ["协作技能课", "Collaboration skills lesson"],
        ["案例研讨课", "Case discussion lesson"],
      ],
    ),
  ],
  "curriculum-design": [
    group(
      ["课程设计者、教师和学习者", "Curriculum designers, teachers, and learners"],
      [
        "建立模块先修关系，并将能力目标对应至少两种评估",
        "Map prerequisites and cover each capability through at least two assessment forms",
      ],
      [
        ["基础课程体系", "Foundational curriculum"],
        ["进阶课程体系", "Advanced curriculum"],
        ["跨学科课程体系", "Interdisciplinary curriculum"],
        ["项目式课程体系", "Project-based curriculum"],
      ],
    ),
    group(
      ["培训负责人、讲师和岗位学员", "Training leads, instructors, and role-based learners"],
      [
        "说明岗位能力、练习安排和工作场景中的迁移证据",
        "Describe role capabilities, practice, and transfer evidence in the workplace",
      ],
      [
        ["新人培养路径", "New hire learning path"],
        ["岗位认证课程", "Role qualification curriculum"],
        ["管理者培养路径", "Manager development path"],
        ["专业技能课程", "Professional skills curriculum"],
      ],
    ),
    group(
      ["课程运营和质量评估人员", "Learning operations and quality reviewers"],
      [
        "为不同起点设计支持，并定义课程复审与改进节奏",
        "Support different starting levels and define curriculum review and improvement cadence",
      ],
      [
        ["混合式学习项目", "Blended learning program"],
        ["远程学习项目", "Remote learning program"],
        ["导师带教项目", "Mentored learning program"],
        ["继续教育项目", "Continuing education program"],
      ],
    ),
  ],
  "financial-model": [
    group(
      ["财务规划人员和业务负责人", "Financial planners and business leaders"],
      [
        "收入、成本和现金流由可追溯的业务驱动与期间假设连接",
        "Link revenue, cost, and cash flow to traceable business drivers and period assumptions",
      ],
      [
        ["年度经营预测", "Annual operating forecast"],
        ["滚动预测", "Rolling forecast"],
        ["业务线预测", "Business unit forecast"],
        ["新业务预测", "New business forecast"],
      ],
    ),
    group(
      ["财务团队和预算责任人", "Finance teams and budget owners"],
      [
        "区分固定与变动支出，标记来源、单位和预算责任人",
        "Separate fixed and variable costs and label sources, units, and budget owners",
      ],
      [
        ["部门预算", "Department budget"],
        ["人员成本规划", "Headcount cost plan"],
        ["运营成本规划", "Operating cost plan"],
        ["资本支出规划", "Capital expenditure plan"],
      ],
    ),
    group(
      ["财务负责人和经营决策人", "Finance leaders and operating decision makers"],
      [
        "基准、乐观和保守情景只改变明确的假设，并展示现金需求",
        "Change only explicit assumptions across base, upside, and downside cases and show cash needs",
      ],
      [
        ["现金流预测", "Cash flow forecast"],
        ["价格敏感性", "Pricing sensitivity"],
        ["收入情景分析", "Revenue scenario analysis"],
        ["成本情景分析", "Cost scenario analysis"],
      ],
    ),
  ],
  "data-dashboard": [
    group(
      ["业务负责人和运营分析人员", "Business leaders and operations analysts"],
      [
        "每项指标写明计算口径、时间窗口和可采取的行动",
        "Define each metric's calculation, time window, and actionable response",
      ],
      [
        ["业务经营看板", "Business performance dashboard"],
        ["销售漏斗看板", "Sales funnel dashboard"],
        ["客户留存看板", "Customer retention dashboard"],
        ["服务质量看板", "Service quality dashboard"],
      ],
    ),
    group(
      ["项目经理和交付负责人", "Project managers and delivery leads"],
      [
        "展示里程碑状态、逾期项目、负责人和数据更新时间",
        "Show milestone status, overdue items, owners, and data freshness",
      ],
      [
        ["项目进度看板", "Project progress dashboard"],
        ["交付质量看板", "Delivery quality dashboard"],
        ["资源负载看板", "Resource workload dashboard"],
        ["风险跟踪看板", "Risk tracking dashboard"],
      ],
    ),
    group(
      ["财务、采购和职能管理人员", "Finance, procurement, and functional managers"],
      [
        "对照预算或目标展示差异，并解释缺失数据与异常值",
        "Show variance against budget or target and explain missing data and outliers",
      ],
      [
        ["预算执行看板", "Budget execution dashboard"],
        ["采购支出看板", "Procurement spending dashboard"],
        ["人员配置看板", "Staffing dashboard"],
        ["培训完成看板", "Training completion dashboard"],
      ],
    ),
  ],
  "business-case": [
    group(
      ["业务发起人和财务审批人", "Business sponsors and finance approvers"],
      [
        "将增量收益、总成本和不投资基线分别建模",
        "Model incremental benefits, total costs, and the no-investment baseline separately",
      ],
      [
        ["新项目投资", "New project investment"],
        ["业务扩张投资", "Business expansion investment"],
        ["新产品投资", "New product investment"],
        ["市场进入投资", "Market entry investment"],
      ],
    ),
    group(
      ["运营负责人和财务评审人员", "Operations leaders and finance reviewers"],
      [
        "效率收益必须注明现状基线、实现条件和避免重复计算的口径",
        "Efficiency benefits state baseline, realization conditions, and how double counting is avoided",
      ],
      [
        ["流程自动化", "Process automation"],
        ["设备更新", "Equipment replacement"],
        ["系统升级", "System upgrade"],
        ["服务外包", "Service outsourcing"],
      ],
    ),
    group(
      ["投资委员会和风险负责人", "Investment committee and risk owners"],
      [
        "展示敏感性、资金峰值、失败情景和阶段退出条件",
        "Show sensitivity, peak funding, downside case, and stage-gate exit conditions",
      ],
      [
        ["试点扩展决策", "Pilot expansion decision"],
        ["产能增加决策", "Capacity increase decision"],
        ["供应链调整决策", "Supply chain change decision"],
        ["合作项目决策", "Partnership investment decision"],
      ],
    ),
  ],
  "product-spec": [
    group(
      ["产品经理、设计师和工程师", "Product managers, designers, and engineers"],
      [
        "每项需求对应用户任务、可观察行为和验收条件",
        "Map every requirement to a user job, observable behavior, and acceptance condition",
      ],
      [
        ["新功能规格", "New feature specification"],
        ["现有功能改进", "Existing feature improvement"],
        ["用户流程优化", "User flow improvement"],
        ["自助服务功能", "Self-service feature"],
      ],
    ),
    group(
      ["工程、支持和运营团队", "Engineering, support, and operations teams"],
      [
        "覆盖正常、空态、失败、恢复与权限边界",
        "Cover normal, empty, failure, recovery, and permission states",
      ],
      [
        ["通知功能", "Notification feature"],
        ["账户设置", "Account settings"],
        ["数据导入流程", "Data import flow"],
        ["审批流程", "Approval flow"],
      ],
    ),
    group(
      ["产品负责人和发布利益相关者", "Product owners and release stakeholders"],
      [
        "明确本次范围、迁移影响、衡量指标和未决问题",
        "Specify scope, migration impact, metrics, and unresolved questions",
      ],
      [
        ["功能替换", "Feature replacement"],
        ["版本迁移", "Version migration"],
        ["试点功能", "Pilot feature"],
        ["功能退役", "Feature retirement"],
      ],
    ),
  ],
  "ux-research": [
    group(
      ["用户研究员、产品经理和设计师", "User researchers, product managers, and designers"],
      [
        "研究问题指向具体产品决定，发现可回溯到观察或引语",
        "Research questions inform a product decision and findings trace to observations or quotes",
      ],
      [
        ["需求探索", "Needs discovery"],
        ["用户访谈", "User interviews"],
        ["任务观察", "Task observation"],
        ["使用情境研究", "Contextual research"],
      ],
    ),
    group(
      ["设计师、研究员和可用性评审人员", "Designers, researchers, and usability reviewers"],
      [
        "写明任务、成功标准、样本局限和失败观察",
        "State tasks, success criteria, sample limits, and observed failures",
      ],
      [
        ["原型可用性测试", "Prototype usability test"],
        ["现有流程测试", "Existing flow test"],
        ["信息架构测试", "Information architecture test"],
        ["移动端任务测试", "Mobile task test"],
      ],
    ),
    group(
      ["产品和客户体验负责人", "Product and customer experience leads"],
      [
        "按影响与证据强度排序机会，并保留反例和未知项",
        "Prioritize opportunities by impact and evidence strength while retaining counterexamples and unknowns",
      ],
      [
        ["客户旅程研究", "Customer journey study"],
        ["流失体验研究", "Churn experience study"],
        ["服务接触点研究", "Service touchpoint study"],
        ["采用障碍研究", "Adoption barriers study"],
      ],
    ),
  ],
  "release-readiness": [
    group(
      ["发布负责人、工程和质量团队", "Release owners, engineering, and quality teams"],
      [
        "列出候选版本、验证结果、阻塞项和发布裁决人",
        "List the release candidate, verification results, blockers, and decision owner",
      ],
      [
        ["常规版本发布", "Routine version release"],
        ["紧急修复发布", "Hotfix release"],
        ["分阶段发布", "Phased release"],
        ["试点版本发布", "Pilot release"],
      ],
    ),
    group(
      ["工程、数据和运维负责人", "Engineering, data, and operations leads"],
      [
        "说明兼容范围、数据影响、观测窗口和已验证的回退步骤",
        "State compatibility, data impact, observation window, and verified rollback steps",
      ],
      [
        ["数据库迁移发布", "Database migration release"],
        ["接口变更发布", "API change release"],
        ["基础设施变更", "Infrastructure change release"],
        ["配置变更发布", "Configuration change release"],
      ],
    ),
    group(
      ["产品、支持和客户成功团队", "Product, support, and customer success teams"],
      [
        "列出受影响用户、沟通安排、支持准备和未验证范围",
        "List affected users, communications, support readiness, and unverified scope",
      ],
      [
        ["客户升级发布", "Customer upgrade release"],
        ["功能默认开启", "Feature default enablement"],
        ["功能迁移发布", "Feature migration release"],
        ["旧功能退役", "Legacy feature retirement"],
      ],
    ),
  ],
  "architecture-decision": [
    group(
      ["架构师和工程团队", "Architects and engineering teams"],
      [
        "比较候选方案对接口、复杂度、演进性和迁移的影响",
        "Compare options by interfaces, complexity, evolvability, and migration impact",
      ],
      [
        ["服务边界", "Service boundary"],
        ["数据存储", "Data storage"],
        ["系统集成", "System integration"],
        ["异步处理", "Asynchronous processing"],
      ],
    ),
    group(
      ["工程、安全和运维评审人员", "Engineering, security, and operations reviewers"],
      [
        "先定义安全与可靠性不变量，再记录方案权衡和失败信号",
        "Define security and reliability invariants before recording tradeoffs and failure signals",
      ],
      [
        ["身份与访问", "Identity and access"],
        ["故障恢复", "Failure recovery"],
        ["可观测性", "Observability"],
        ["密钥管理", "Secret management"],
      ],
    ),
    group(
      ["技术负责人和受影响团队", "Technical leads and affected teams"],
      [
        "列出兼容约束、拒绝方案的理由和复审触发条件",
        "List compatibility constraints, reasons for rejected options, and review triggers",
      ],
      [
        ["框架选择", "Framework selection"],
        ["部署方式", "Deployment approach"],
        ["版本兼容", "Version compatibility"],
        ["模块拆分", "Module decomposition"],
      ],
    ),
  ],
  "onboarding-program": [
    group(
      ["新员工、直属经理和入职伙伴", "New hires, managers, and onboarding buddies"],
      [
        "30、60、90天目标应有实践任务、反馈人和检查点",
        "Give 30-, 60-, and 90-day outcomes practical tasks, feedback owners, and checkpoints",
      ],
      [
        ["通用新员工入职", "General new hire onboarding"],
        ["工程岗位入职", "Engineering role onboarding"],
        ["运营岗位入职", "Operations role onboarding"],
        ["销售岗位入职", "Sales role onboarding"],
      ],
    ),
    group(
      ["新任管理者和其上级", "New managers and their leaders"],
      [
        "明确团队交接、关键关系、决策权限和前90天结果",
        "Define team handover, key relationships, decision authority, and first-90-day outcomes",
      ],
      [
        ["新任经理入职", "New manager onboarding"],
        ["内部晋升交接", "Internal promotion transition"],
        ["跨团队调岗", "Cross-team transfer"],
        ["新负责人接任", "New lead transition"],
      ],
    ),
    group(
      ["人力资源、带教人员和新人", "People operations, mentors, and new joiners"],
      [
        "为不同入职条件安排资料、联系人、支持与反馈",
        "Provide resources, contacts, support, and feedback for differing onboarding conditions",
      ],
      [
        ["远程入职", "Remote onboarding"],
        ["实习生入职", "Intern onboarding"],
        ["批量入职", "Cohort onboarding"],
        ["返岗入职", "Return-to-work onboarding"],
      ],
    ),
  ],
  "performance-review": [
    group(
      ["员工和直属经理", "Employees and direct managers"],
      [
        "使用约定目标与具体行为证据，允许员工补充背景和异议",
        "Use agreed goals and concrete behavioral evidence, allowing employee context and disagreement",
      ],
      [
        ["季度绩效对话", "Quarterly performance conversation"],
        ["年度绩效回顾", "Annual performance review"],
        ["项目结束回顾", "Post-project performance review"],
        ["阶段目标回顾", "Milestone goal review"],
      ],
    ),
    group(
      ["员工、经理和发展导师", "Employees, managers, and development mentors"],
      [
        "发展计划包含可执行练习、支持资源和复查时间",
        "Development plans include actionable practice, support, and review dates",
      ],
      [
        ["专业能力发展", "Professional capability development"],
        ["管理能力发展", "Management capability development"],
        ["协作能力发展", "Collaboration capability development"],
        ["岗位成长计划", "Role growth plan"],
      ],
    ),
    group(
      ["经理和人力资源评审人员", "Managers and people reviewers"],
      [
        "说明评价周期、证据来源、角色背景与隐私访问范围",
        "State the review period, evidence sources, role context, and privacy access",
      ],
      [
        ["试用期回顾", "Probation review"],
        ["岗位转换回顾", "Role transition review"],
        ["晋升准备回顾", "Promotion readiness review"],
        ["目标调整回顾", "Goal adjustment review"],
      ],
    ),
  ],
  "incident-review": [
    group(
      ["事故响应人员和服务负责人", "Incident responders and service owners"],
      [
        "记录检测、缓解、恢复与验证时间，区分事实和未知项",
        "Record detection, mitigation, recovery, and validation times; separate facts from unknowns",
      ],
      [
        ["服务中断", "Service outage"],
        ["服务性能下降", "Service degradation"],
        ["发布引发故障", "Release-related incident"],
        ["依赖服务故障", "Dependency incident"],
      ],
    ),
    group(
      ["安全、数据和运营负责人", "Security, data, and operations owners"],
      [
        "明确影响范围、证据保护、通报责任和后续核查",
        "Specify impact, evidence preservation, notification ownership, and follow-up verification",
      ],
      [
        ["数据处理事故", "Data processing incident"],
        ["访问权限事故", "Access control incident"],
        ["配置错误事故", "Configuration incident"],
        ["信息暴露事件", "Information exposure incident"],
      ],
    ),
    group(
      ["流程负责人和参与处置团队", "Process owners and response teams"],
      [
        "将系统性控制缺口与纠正行动、负责人和复验方式对应",
        "Map systemic control gaps to corrective actions, owners, and retest methods",
      ],
      [
        ["交付延误事件", "Delivery delay incident"],
        ["质量缺陷事件", "Quality defect incident"],
        ["沟通失误事件", "Communication failure incident"],
        ["操作流程事故", "Operational process incident"],
      ],
    ),
  ],
  "governance-review": [
    group(
      ["治理委员会和控制负责人", "Governance committee and control owners"],
      [
        "每项发现对应控制标准、抽样证据、影响和整改责任",
        "Map each finding to control criteria, sampled evidence, impact, and remediation owner",
      ],
      [
        ["年度治理评审", "Annual governance review"],
        ["控制有效性评审", "Control effectiveness review"],
        ["风险登记评审", "Risk register review"],
        ["整改进度评审", "Remediation progress review"],
      ],
    ),
    group(
      ["采购、运营和风险管理人员", "Procurement, operations, and risk managers"],
      [
        "写明评审范围、样本覆盖期、例外及剩余风险",
        "State review scope, sample period, exceptions, and residual risk",
      ],
      [
        ["供应商治理评审", "Supplier governance review"],
        ["采购控制评审", "Procurement controls review"],
        ["外包服务评审", "Outsourced service review"],
        ["支出授权评审", "Spending authority review"],
      ],
    ),
    group(
      ["数据、安全与合规负责人", "Data, security, and compliance owners"],
      [
        "保留授权、访问、例外和整改证据，不将抽样结果外推为全面通过",
        "Retain authorization, access, exception, and remediation evidence without treating samples as complete assurance",
      ],
      [
        ["访问权限评审", "Access rights review"],
        ["数据治理评审", "Data governance review"],
        ["记录保留评审", "Records retention review"],
        ["制度执行评审", "Policy implementation review"],
      ],
    ),
  ],
};
