import type {
  CreativeAuthoredScenario,
  CreativeExtendedFamily,
  CreativeTranslation,
} from "./creative-template-authoring";

type Pair = CreativeTranslation;
type ScenarioRow = readonly [Pair, Pair, Pair, Pair, Pair];
type FamilyInput = Omit<
  CreativeExtendedFamily,
  "sections" | "acceptance" | "workflow" | "scenarios"
> & {
  sections: readonly Pair[];
  audience: Pair;
  scenarios: readonly ScenarioRow[];
};

// Order follows the stable twelve scenario IDs in each family.
const SCENARIO_DETAILS: Readonly<Record<string, readonly Pair[]>> = {
  "outlook-email": [
    [
      "逐项核对含税单价、运费、交付周期、付款条件和报价有效期；缺项形成澄清问题，可比性不足时暂不推荐供应商。",
      "Compare tax-inclusive prices, freight, lead times, payment terms, and validity; ask about gaps and defer recommendations when quotes are not comparable.",
    ],
    [
      "邀请中列出至少两个可选时段及当地日期、时区、预计时长和面试形式；询问无障碍需求，确认前保留时段待定状态。",
      "Offer at least two time-zoned slots with dates, duration, and interview format; ask about accessibility and leave slots tentative until confirmed.",
    ],
    [
      "将必交、可替代和已收到的材料分开，附安全提交渠道与提醒日期；仅列收件人有权查看的附件名称，不假定延迟原因。",
      "Separate required, substitute, and received materials; provide a secure submission route and reminder date without exposing restricted names or assuming the reason for delay.",
    ],
    [
      "将现有合同义务、可商议选项和未经批准的建议分栏，核对通知窗口与自动续约条款后再约讨论，不承诺新价格。",
      "Separate existing obligations, negotiable options, and unapproved proposals; verify notice and automatic-renewal terms before scheduling a discussion.",
    ],
    [
      "区分本周实际完成、预计完成和有依赖的里程碑，阻塞事项写清需要谁在何日前决定，并附对应项目记录位置。",
      "Separate completed, forecast, and dependent milestones; turn blockers into decisions with owners, dates, and project-record references.",
    ],
    [
      "每个候选时段同时展示当地日期、时区和跨日情况，检查夏令时转换并提供备选；收到全部确认前不称会议已预约。",
      "Show local date, time zone, and date crossings for each option, check daylight-saving conversion, and do not call the meeting booked before confirmation.",
    ],
    [
      "保留原邮件的错误表述、经核实的修订版本及影响范围，明确哪些收件人需要替换附件或停止使用旧数据。",
      "Preserve the erroneous wording, verified correction, and impact; identify recipients who must replace attachments or stop using old data.",
    ],
    [
      "按投诉影响、客户诉求、已处理动作及响应期限排序升级内容；内部讨论与客户可见答复分开，赔付需授权确认。",
      "Order the escalation by impact, customer request, actions, and response deadline; separate internal discussion and require approval for compensation.",
    ],
    [
      "对外回复只写缺席期间、授权替代联系人和紧急渠道；内部版本另列交接事项，起止时间与自动回复设置由本人复核。",
      "Limit external replies to absence dates, an authorized alternate, and an urgent channel; keep handover details internal and manually verify the settings.",
    ],
    [
      "按会签顺序列明每人的条款范围、反馈格式和截止时间，收回意见时记录合同版本；退回、未回复和批准不得混同。",
      "Specify clause scope, feedback format, and deadline for each reviewer, recording the version and distinguishing returned, unanswered, and approved states.",
    ],
    [
      "把行动逐项链接到会议记录，列交付定义、责任人和日期；尚未决定的建议单列确认问题，不伪装成已经达成的共识。",
      "Link actions to minutes with completion criteria, owners, and dates; list unresolved suggestions separately rather than portraying them as agreed.",
    ],
    [
      "按项目、线程主题和保留期限建立索引，记录原邮箱位置、附件版本及法律冻结状态；归档或清理仅提供人工步骤。",
      "Index by project, subject, and retention, recording mailbox location, attachment versions, and legal holds; provide manual archiving steps only.",
    ],
  ],
  "onenote-notes": [
    [
      "以项目阶段建立页面入口，分别链接章程、里程碑和决策记录；为每页登记维护人、更新时间以及失效链接处理方式。",
      "Index pages by phase and link charters, milestones, and decisions; record page owners, update dates, and how broken links will be handled.",
    ],
    [
      "将合同义务、当前服务状态、客户偏好和未解决工单分区，逐项标识资料授权与接手人，口头承诺保留待确认。",
      "Separate contract terms, service status, preferences, and open tickets; mark authorization and receiving owners, leaving oral promises unconfirmed.",
    ],
    [
      "把研究问题拆成可证伪的小问题，为每条论点记录原文位置、证据强度和相反材料；缺少来源的判断不纳入结论。",
      "Break research into falsifiable questions, recording passages, evidence strength, and contrary material; exclude unsourced judgments from conclusions.",
    ],
    [
      "按症状建立诊断分支，记录适用环境、复现方法、停止条件及回退步骤；只有对应环境实测成功才称恢复措施已验证。",
      "Branch by symptom with environment, reproduction, stop conditions, and rollback; call a recovery step verified only after testing in that environment.",
    ],
    [
      "按入职首日、第一周和试用期安排资料入口、导师及申请动作；权限申请保留待批准，笔记不得存放密码或令牌。",
      "Organize first-day, first-week, and probation resources, mentors, and requests; keep access pending until approved and exclude credentials.",
    ],
    [
      "把客户原话、访谈者解释、购买条件和预计成交分成独立栏目；保留问题与回答的对应关系，不推断敏感个人属性。",
      "Separate customer quotations, interpretations, buying conditions, and sales forecasts; preserve question-answer links and avoid inferring sensitive traits.",
    ],
    [
      "每项学习结论对应已完成练习、反馈和一个可迁移到工作的例子；尚未实践的知识列为下周验证，不计作熟练掌握。",
      "Pair learning claims with completed exercises, feedback, and workplace application; schedule unpracticed knowledge for validation rather than claiming mastery.",
    ],
    [
      "按真实任务、发生频次和失败影响整理受访者原话，再列验证假设；小样本结论不得外推总体比例或承诺产品排期。",
      "Organize quotes by task, frequency, and failure impact, then list hypotheses; do not infer population rates or promise roadmap dates from small samples.",
    ],
    [
      "摘录卡同时列研究方法、样本边界、原文页码与反例；不同文献结论冲突时并列呈现，不能擅自补造引用或页码。",
      "Capture method, sample limits, source pages, and counterexamples; present conflicting studies side by side without inventing citations.",
    ],
    [
      "以批准状态和生效日识别现行条款，草案、废止版本及过渡规定使用不同标签；每条摘要都链接到可核对的原条文。",
      "Identify current rules by approval and effective date, label drafts, retired versions, and transitions separately, and cite original clauses.",
    ],
    [
      "每个决定记录备选方案、采纳理由、授权人和复审触发条件；撤销或替换后保留旧决定及其实际适用时间。",
      "Record options, rationale, authorized owner, and review triggers for each decision; preserve superseded decisions and their effective periods.",
    ],
    [
      "建立原路径、目标页面、附件、权限负责人及迁移批次映射；目标端抽查通过后才标记完成，缺失项保留在清单。",
      "Map source paths to target pages, attachments, permission owners, and batches; mark completion only after destination-side sampling.",
    ],
  ],
  "teams-collaboration": [
    [
      "按公开讨论、项目执行和受限决策拆分频道，写明用途、成员角色及退场条件；跨组织来宾按最小必要范围加入，项目结束后复核成员名单。",
      "Separate open discussion, delivery, and restricted decisions, defining purposes, membership, and exit conditions; review guest membership at project close.",
    ],
    [
      "启动会先确认目标、边界与关键依赖，再逐项记录决定和分工；散会时仍无人接受的行动标记待分派，不计作已交接，并安排责任人确认时间。",
      "Confirm goals, boundaries, and dependencies before recording decisions; mark unaccepted actions as unassigned and schedule owner confirmation.",
    ],
    [
      "交班单包含未闭事件、最后观察时间、安全下一步和升级联系人；接班人逐项确认前，原值班人继续保有责任，并记录响应超时的备用联系人。",
      "Include open incidents, last observed time, safe next action, and escalation contact; retain duty until acknowledgment and name a fallback for nonresponse.",
    ],
    [
      "将正式决定与讨论提案、个人意见和待批准事项分栏，注明决定者、授权来源、受影响范围和后续复审时间，并保留异议原始记录。",
      "Separate decisions, proposals, opinions, and pending approvals, recording authority, impact, review time, and the original dissent.",
    ],
    [
      "每类资料列出查看、编辑及批准角色，临时例外须有申请理由和失效日；能打开链接不代表拥有批准权限，到期须人工检查撤权。",
      "List readers, editors, and approvers with exception reasons and expiry; link access does not imply approval, and revocation requires review.",
    ],
    [
      "议程为每个主题设置时间盒、发言顺序和决策出口，并为掉线者提供补充渠道；录制需单独征得参会者同意。",
      "Timebox topics with speaking order and decision outcome, offer a fallback for disconnected attendees, and obtain separate recording consent.",
    ],
    [
      "固定送审版本、反馈期限和问题编号，要求意见引用章节及严重程度；文件更新后重新确认未关闭的旧评论，并列出意见处理责任人。",
      "Freeze review version, deadline, and issue IDs; require section and severity, revalidate open comments after edits, and assign disposition owners.",
    ],
    [
      "根据影响范围、事件级别和服务时限明确通知顺序，更新消息保留事实时间线；未经证实的根因只写为调查假设。",
      "Set notification order by impact, severity, and service deadline; preserve factual updates and label unconfirmed causes as hypotheses.",
    ],
    [
      "轮换共同工作时段，交接表同时标明当地日期、时区和节假日；夏令时变化时重算，覆盖空档交由负责人处理并设置紧急联系路径。",
      "Rotate shared hours with local dates, zones, and holidays; recalculate daylight-saving transitions and assign emergency coverage for gaps.",
    ],
    [
      "按第一天、首周和首月安排导师、欢迎消息及参与讨论的机会；访问权限只有管理员确认后才能标为已开通，未开通事项提供临时联系人。",
      "Schedule mentoring, welcome messages, and participation by phase; verify granted access and provide a contact for outstanding requests.",
    ],
    [
      "为合作方列明允许接触的频道、文件类别和到期日，内部责任人复核外部共享策略并在期满时决定续权或移除，留下复核记录。",
      "Specify partner channels, file classes, and expiration; an internal owner checks policy, records the review, and decides renewal or removal.",
    ],
    [
      "把决策、未决事项和附件整理为主题索引，保留原消息时间及版本；涉及法律冻结的讨论不得因归档而清除。",
      "Index decisions, open items, and attachments with original message times and versions; do not purge discussion subject to legal hold.",
    ],
  ],
  "sharepoint-information": [
    [
      "用员工实际查找任务设计一级和二级入口，分别测试新员工、移动端及权限不足读者是否能够理解页面去向。",
      "Design primary and secondary navigation from real employee tasks; test findability for new hires, mobile users, and restricted readers.",
    ],
    [
      "按起草、协作、批准发布与长期归档划分资料库，明确正式版本的唯一入口，避免同一文件在多处形成不一致副本。",
      "Partition libraries for drafts, collaboration, approved publication, and archives; identify the authoritative entry to avoid inconsistent copies.",
    ],
    [
      "将起草人、审阅人、签署人及外部顾问分别映射到查看或编辑角色，合同结束后复核临时授权和法律保留要求，并登记例外审批。",
      "Map drafters, reviewers, signers, and external counsel to roles; record exceptions and review temporary access and retention at contract close.",
    ],
    [
      "登记正式批准版本、生效日期、适用对象及废止时间；将草案与现行制度隔离，历史页面保留指向替代文件的提示，并保留批准记录索引。",
      "Record approved version, dates, audience, and approval index; isolate drafts from current policy and link historical pages to replacements.",
    ],
    [
      "字段字典列明项目编号唯一性、阶段选项、责任人和版本规则，用实际筛选任务检验字段必要性，并标记旧数据缺项。",
      "Document project-key uniqueness, phase values, owners, and version rules; test fields against retrieval tasks and flag legacy gaps.",
    ],
    [
      "用同义词、文档状态和所属部门组合测试检索，检查过期资料排名以及无权限结果的展示，不虚构线上搜索效果。",
      "Test synonyms, document status, and department filters, including stale and restricted results; do not invent live search behavior.",
    ],
    [
      "迁移表记录源路径、目标库、文件数量、附件和责任人，前后用数量及抽样版本对账，权限和链接在目标端复核，并记录失败项目。",
      "Map sources, target libraries, counts, attachments, and owners; reconcile sampled versions, verify destination access, and log failures.",
    ],
    [
      "为草稿、现行、复审到期和长期保留分别定义状态及责任人；法律冻结覆盖普通删除规则，过期内容不能直接清除，须登记复核决定。",
      "Define owners and lifecycle states; legal holds override routine deletion, and expired content requires a recorded review decision.",
    ],
    [
      "申请必须列共享对象、用途、文件范围与截止日期，复核匿名链接和下载权限；到期由授权管理员确认收回或续期。",
      "Require audience, purpose, file scope, and end date; check anonymous links and downloads, then have an administrator revoke or renew access.",
    ],
    [
      "每条公告注明业务负责人、发布时间、复审日和撤下条件；过期或联系人失效的消息先标为待确认，再由负责人处置。",
      "Assign each notice an owner, publication date, review date, and removal trigger; flag expired notices for an owner decision.",
    ],
    [
      "恢复前核对版本链、签出状态、修改者和业务影响，先复制候选版本供审阅；获确认后再由管理员人工执行恢复。",
      "Check version lineage, checkout state, editors, and impact before copying a candidate for review; an administrator performs approved restoration.",
    ],
    [
      "法务保留登记案件编号、冻结依据、资料范围、保管人和解除批准人；冻结期间禁止按常规保留期自动清理。",
      "Record case ID, hold basis, covered material, custodian, and release approver; suspend routine deletion during the hold.",
    ],
  ],
  "visio-process-spec": [
    [
      "图中区分票据缺失、超政策额度和币种异常，并分别画出员工补正、主管审批及财务退回的路径和终止条件，标明补正材料接收人。",
      "Diagram receipt, limit, and currency exceptions with employee correction, manager approval, finance return paths, and the correction recipient.",
    ],
    [
      "依申请金额、预算归属和采购类别选择审批泳道；金额或供应商发生变化时回到判断节点，不沿用失效批准。",
      "Route approval by amount, budget, and purchase category; return to the decision node if amount or supplier changes invalidate approval.",
    ],
    [
      "为不同紧急度标注响应计时、处理人和升级条件，等待客户补充与内部处理中使用不同状态，不自动关闭逾期单。",
      "Show timers, owners, and escalation by severity; distinguish waiting for customers from internal work and do not auto-close overdue tickets.",
    ],
    [
      "分别画出人事资料、账号申请、设备领取和培训确认，合同工或远程员工的例外流程需有指定审批角色。",
      "Diagram HR records, account requests, equipment, and training separately, with named approval roles for contractor or remote exceptions.",
    ],
    [
      "串联业务审阅、法务会签和签署授权，签前核对最终版本及附件；任一审批退回时标明返工起点与重新送审条件。",
      "Connect business review, legal routing, and signature authority; check final versions and attachments and define rework and resubmission paths.",
    ],
    [
      "以采购订单、收货记录和发票建立三方匹配分支，数量、税额或供应商不一致时转财务核实，不直接进入付款，并记录差异单编号。",
      "Match purchase order, receipt, and invoice; route mismatches to finance before payment and record the discrepancy ID.",
    ],
    [
      "按投诉严重度和客户影响绘制处理、升级、客户反馈及关闭条件；赔付分支须回到授权审批，不能由流程图直接承诺，客户回访结果需留档。",
      "Map treatment, escalation, customer updates, and closure by severity; authorize compensation and retain follow-up results.",
    ],
    [
      "画出身份核验、权限审批、最小授权、到期复核与撤销节点；紧急访问应单列有效期和事后审计责任，申请被拒时通知申请人并保留拒绝依据。",
      "Diagram identity, approval, least privilege, expiry, and revocation; give emergency access an audit owner and notify applicants of recorded denials.",
    ],
    [
      "区分预约到货、数量清点、质量检验和入账，破损或数量短少流向隔离与供应商确认，不把到货等同验收，差异留待仓储负责人签认。",
      "Separate arrival, counting, quality inspection, and posting; quarantine discrepancies for supplier confirmation and warehouse sign-off.",
    ],
    [
      "记录异常发现、原始数据保全、影响判断和修正授权，验证结果不一致时回到调查节点，不覆盖原始记录。",
      "Preserve source data through discovery, impact assessment, and correction approval; return failed verification to investigation without overwriting originals.",
    ],
    [
      "在部门交接节点写明交付物、接收标准和确认人，缺件或拒收时返回责任方；依赖未完成不得进入最终验收，退回原因进入交接记录。",
      "At each handoff define deliverables, acceptance criteria, and receiver; log return reasons and resolve dependencies before final acceptance.",
    ],
    [
      "围绕人员不可用、系统中断和供应中断分别画决策分支，标注启动授权、备援条件和恢复后退出临时方案的节点。",
      "Branch on unavailable staff, system outage, and supply interruption, showing activation authority, fallback conditions, and exit from temporary measures.",
    ],
  ],
  "project-schedule": [
    [
      "逐条列前置里程碑、交付验收条件和负责人，区分硬依赖与可并行事项；缺少已确认日期的节点保持待定。",
      "List predecessor milestones, acceptance criteria, and owners, distinguishing hard dependencies from parallel work and leaving unconfirmed dates open.",
    ],
    [
      "从上线窗口倒排测试、培训、数据准备和变更冻结，给回滚演练及最终批准预留节点，节假日和团队容量单独核对，并记录上线授权人。",
      "Plan backward through testing, training, data, freeze, rollback, and approval, checking capacity and recording the launch authorizer.",
    ],
    [
      "按课程准备、讲师确认、报名、授课和评估排序，核对场地容量及参与者班次，未确认讲师不得标为排期完成，并列缺席补课方案。",
      "Sequence preparation, instructor confirmation, registration, delivery, and evaluation; check capacity and provide make-up options without assuming instructor availability.",
    ],
    [
      "以活动日为终点倒排场地、物料、嘉宾和现场彩排，记录每项采购最晚决定日与供应延误时的替代方案，并明确现场验收负责人。",
      "Work backward from venue, materials, guests, and rehearsal with latest decision dates, supply alternatives, and an on-site acceptance owner.",
    ],
    [
      "按岗位、面试轮次和参与人员可用时间排程，标注候选人时区及缓冲；邀约回复前不得将时段写成正式预约。",
      "Schedule by role, interview stage, availability, candidate time zone, and buffer; keep a slot tentative until the invitation is accepted.",
    ],
    [
      "列出停机窗口、数据备份、迁移、校验与回退决策点，跨时区显示日期和偏移；恢复时间须以演练证据为依据，未演练步骤明确标记。",
      "Show downtime, backups, migration, checks, rollback, and time zones; base recovery estimates on drills and label untested steps.",
    ],
    [
      "每周任务对照前置验收、材料到场、施工许可和现场资源，记录天气或安全限制导致的不可施工时段及负责人，并预留复工检查。",
      "Match work to acceptance, materials, permits, and resources; record restrictions and schedule a restart check.",
    ],
    [
      "按人员或设备列出同一时间的占用，比较任务优先级与替代资源；冲突由资源负责人确认，不暗中超配，并记下调整后的影响。",
      "Show simultaneous staff or equipment allocations, compare priorities and substitutes, and record the approved resolution's impact.",
    ],
    [
      "将延期拆为实际偏差、关键路径影响、追回选项和新增风险，分别给出压缩工作量、调整范围或延期的决策条件及审批人。",
      "Break delay into variance, critical-path impact, recovery options, risks, decision criteria, and the approving owner.",
    ],
    [
      "对照订单交期、生产进度、运输和验收节点，记录供应商承诺与内部预测的差异；缺少确认时保留交付日期待定并安排追询。",
      "Compare order, production, transport, and acceptance, separating commitments from forecasts and assigning follow-up for unconfirmed dates.",
    ],
    [
      "把季度目标拆到可衡量里程碑，记录目标口径、责任人、检查频率和跨团队依赖；目标值未经批准时不得当成承诺，阶段结果附证据。",
      "Break objectives into measurable milestones with definitions, owners, cadence, dependencies, and evidence; unapproved targets are not commitments.",
    ],
    [
      "对比原计划与变更后的工期、关键路径和资源占用，保留未批准情景；只有变更负责人确认后才能更新基线。",
      "Compare baseline and proposed duration, critical path, and resources, retaining unapproved scenarios until the change owner authorizes a new baseline.",
    ],
  ],
  "contract-review": [
    [
      "逐项对照付款触发条件、发票要求、币种、税费和逾期处理，列出与交付验收不一致之处供法务及财务确认。",
      "Compare payment triggers, invoice requirements, currency, taxes, and late-payment terms with acceptance obligations for legal and finance review.",
    ],
    [
      "核实续约期限、通知方式和最后通知日，列明自动续约前的人工决策窗口；缺少签署版本时不推定条款生效。",
      "Verify renewal periods, notice methods, and final notice dates; identify the decision window and do not assume effectiveness without the signed version.",
    ],
    [
      "对照责任上限金额、适用损失范围和例外情形，分别列双方承担方式；不将商业建议包装成法律结论，对无限责任例外单列。",
      "Compare liability caps, covered losses, exclusions, and allocation; separately flag uncapped exceptions and distinguish legal advice from business recommendations.",
    ],
    [
      "检查保密信息定义、披露例外、允许接收人、存续期限和返还销毁要求，对无法执行的约束标记复核，并注明接收方保留备份的例外。",
      "Review definitions, disclosures, recipients, survival, return and destruction duties, and retained-backup exceptions; flag impractical terms.",
    ],
    [
      "核对处理目的、数据类别、跨境传输、分包商和事故通知时限，缺少附件或适用法规分析时提交专业人员，并记录责任联系人。",
      "Check purposes, data classes, transfers, subprocessors, notice periods, and responsible contacts; refer missing schedules or legal analysis to specialists.",
    ],
    [
      "对照交付清单、验收标准、缺陷整改期限和变更控制，区分已接受成果与待签署变更，避免默认沉默即验收，并列拒收处理流程。",
      "Compare deliverables, acceptance criteria, defects, and change control; distinguish signed changes and define rejection handling without inferring acceptance from silence.",
    ],
    [
      "区分既有成果、新开发成果、第三方素材和许可范围，列使用期限、地域及再许可限制，来源不明的权利留待核实。",
      "Separate background, newly developed, and third-party assets, listing license duration, territory, and sublicensing restrictions for verification.",
    ],
    [
      "按违约事件、补救期限、解除通知和解除后交接逐项比较，指出需要证据或人工决定的触发条件，不代替律师判断。",
      "Compare breach events, cure periods, termination notices, and transition obligations; identify evidence and decisions for qualified legal review.",
    ],
    [
      "核对适用法律、管辖或仲裁机构、争议通知和语言条款是否一致，对跨境执行及法律适用问题明确交由专业审查，保留通知条款原文。",
      "Check governing law, dispute forum, notices, and language, preserving the notice clause and referring cross-border enforcement to counsel.",
    ],
    [
      "检查允许分包的范围、事先同意、保密和数据处理义务，以及主承包商对分包结果的责任，未知分包商不得默认为获准，变更需重新审查。",
      "Review subcontracting scope, prior consent, confidentiality, data duties, and prime-contractor responsibility; review changes and never assume approval.",
    ],
    [
      "明确服务指标口径、统计窗口、排除项和赔付计算方式，将约定目标与实际监测数据分开，缺少监测证据时标未验证。",
      "Define service metrics, windows, exclusions, and credit calculations; separate contractual targets from observed data and flag absent evidence.",
    ],
    [
      "逐条对比签署基线与修订稿，标明新增、删除、责任变化及引用条款联动；不覆盖原件，未经批准差异保留待议并注明建议审阅角色。",
      "Compare signed baseline and revisions, including additions, removals, responsibilities, and cross-references; preserve originals and identify reviewers.",
    ],
  ],
  "meeting-minutes": [
    [
      "按事项列背景、备选方案、决策依据和授权人，明确仍需管理层选择的问题；未获批准的建议与正式决定分栏并注明下一次决策时间。",
      "List background, options, rationale, and authority; separate pending choices from approved decisions and schedule the next decision point.",
    ],
    [
      "只记录本周期状态变化、阻塞和下一步，每项行动带责任人、截止日与验收方式；无人认领的工作单独标待分派并在下次例会跟踪确认。",
      "Record period changes, blockers, and actions with owners, dates, and acceptance; track unassigned work at the next meeting.",
    ],
    [
      "记录项目目标、范围边界、关键里程碑和依赖，并确认各方职责；对尚未签署的章程或预算标明待批准，列出下一步确认人和截止时间。",
      "Capture goals, scope, milestones, dependencies, and responsibilities; mark unsigned charters or budgets pending with an owner and deadline.",
    ],
    [
      "把客户原话与团队理解分开，按使用场景、约束和待验证问题归类；未确认功能和时间不得写成对客户的交付承诺，并记录回访联系人。",
      "Separate customer statements from interpretations by use case, constraint, and question; do not promise unconfirmed features or dates, and record the follow-up contact.",
    ],
    [
      "按发现、响应、缓解和恢复建立时间线，区分已证实原因与假设；改进项注明负责人和验证方式，避免归咎个人。",
      "Build a discovery-to-recovery timeline, separating verified causes from hypotheses; assign improvement owners and checks without personal blame.",
    ],
    [
      "逐家记录评审维度、证据、风险和未决澄清，报价比较须保持税费与交付范围同口径；未批准结果不得称为中标，并安排澄清责任人。",
      "Record criteria, evidence, risks, and clarification owners per supplier; compare tax and scope consistently without asserting an unapproved award.",
    ],
    [
      "区分已发生、预算申请和预测金额，记录币种、期间与调整原因；审批决定应引用授权记录，缺席者意见不作推断并保留复核入口。",
      "Separate actual, requested, and forecast amounts with currency, period, and reasons; cite approval and offer absent participants a review path.",
    ],
    [
      "标明会议日期、时区、参会和掉线人员，决议与聊天补充分别引用；录音和转写仅在实际获得授权时列为来源，无法核实时标明缺口。",
      "Record time zone, attendees, and disconnections; cite decisions and chat separately, using recordings only with verified authorization.",
    ],
    [
      "按争议点并列各部门立场、支持证据、影响和可接受方案，记录决策权限及升级期限，不把未解决分歧写成一致意见，保留复议渠道。",
      "Present positions, evidence, impacts, options, authority, and escalation dates, preserving disagreement and a reconsideration path.",
    ],
    [
      "逐项记录审核发现、证据位置、整改责任人、到期日和复核标准；关闭状态必须依据复核证据而非整改计划，逾期项目注明升级对象。",
      "Log findings, evidence, owners, due dates, and verification criteria; close on evidence rather than plans and escalate overdue items.",
    ],
    [
      "对照培训目标、参与情况、练习反馈与讲师复盘，区分满意度和能力提升证据；未开展测评时不推断培训成效，列出后续测量计划。",
      "Compare objectives, participation, exercise feedback, and facilitator review; distinguish satisfaction from learning and plan any missing assessment.",
    ],
    [
      "逐项记录产品问题、可选方案、取舍依据和决定范围，注明依赖与复审条件；设计建议未经授权不得称为发布计划，并记录决定人。",
      "Capture product questions, options, rationale, scope, dependencies, review triggers, and decision owners; unapproved suggestions are not release plans.",
    ],
  ],
  "business-correspondence": [
    [
      "正文说明拟合作事项、双方可能投入、回复联系人和建议会谈时间；未签署前只使用邀请语气，不暗示合作已达成，附件范围由经办人核对。",
      "State proposed collaboration, potential contributions, contact, and discussion time; verify attachments and do not imply an agreement.",
    ],
    [
      "区分已确认延期原因、受影响交付项与拟议新时间，提出减轻影响及确认方式；责任和补偿须按合同与授权审阅。",
      "Separate confirmed causes, affected deliverables, and proposed dates; suggest mitigation and confirmation, subject to contract and authority review.",
    ],
    [
      "逐项引用合同编号、应付金额、币种、到期日和已核对付款记录，预留对账渠道；争议金额不得直接写成确定欠款，并注明复核联系人。",
      "Cite contract, amount, currency, due date, reconciled payments, and a reconciliation contact; do not assert disputed balances as settled debt.",
    ],
    [
      "将原约定和拟变更的范围、价格、日期及责任并排，写清签署生效条件；在双方批准前不把草案当成合同补充协议，保留原版本编号。",
      "Compare original and proposed scope, price, dates, and responsibilities, retaining the baseline version and signature conditions without claiming execution.",
    ],
    [
      "写明会议目的、议题、日期时区、地点或参会方式与回复期限，附件和参会人员以已授权信息为准；候选时间尚未确认时须注明。",
      "State purpose, agenda, date, time zone, venue, RSVP deadline, and authorized attendees; mark a proposed time as unconfirmed.",
    ],
    [
      "为每项货物或服务列规格、数量、交期、报价币种、税费口径和报价有效期，要求明确运费与付款条件，不泄露竞争方报价，并留澄清联系人。",
      "Specify item, quantity, delivery, currency, tax basis, validity, freight, and payment, providing a clarification contact without disclosing competitors' prices.",
    ],
    [
      "回复逐项列产品范围、数量、含税或未税价格、有效期及交付条件；未经授权的折扣和保证保持待审批，并说明报价适用地区。",
      "Reply with scope, quantity, tax treatment, region, validity, and delivery terms; leave unauthorized discounts or guarantees pending approval.",
    ],
    [
      "先确认事实与受影响范围，再表达歉意并说明已批准的处理步骤和联系渠道；原因未知或赔偿未定时明确保留。",
      "Confirm facts and impact, apologize, and state approved remedies and contact channels; leave unknown causes and compensation unresolved.",
    ],
    [
      "核对终止依据、通知送达方式、合同期限和后续交接义务，明确这是待法务审批的草稿，不声称通知已经送达。",
      "Verify termination basis, delivery method, term, and transition duties; label the notice as a legal-review draft, not a delivered notice.",
    ],
    [
      "具体列申请资料名称、用途、格式、提供期限和安全传输方式；最小化个人信息并注明缺件时的替代联系人、接收人和补交期限。",
      "List requested material, purpose, format, deadline, secure transfer, alternate and receiving contacts, and correction deadline while minimizing personal data.",
    ],
    [
      "按适用对象、生效日期、具体要求和咨询渠道组织通知，涉及制度变化时引用批准版本，尚未批准内容注明征求意见并附反馈截止日。",
      "Organize by audience, effective date, action, and contact; cite approved policy and give a feedback deadline for unapproved consultation.",
    ],
    [
      "核验代表身份、授权事项、有效期和签署权限，引用授权文件编号；授权范围不明时列待核实，不能替组织作出承诺，过期授权需更新。",
      "Verify identity, delegated matters, duration, and signing authority against authorization records; leave unclear scope unresolved and renew expired authority.",
    ],
  ],
  "learning-assessment": [
    [
      "将学习目标映射到前测题目和技能基线，分别统计不会、未接触和未作答；前测仅用于调整课程，不直接作人事结论并注明结果用途。",
      "Map objectives to pretest questions and a skills baseline; distinguish unfamiliar, unexposed, and unanswered responses and disclose the non-employment use.",
    ],
    [
      "围绕岗位任务设置知识、实操和异常处理题，列评分依据与观察记录；评价只采用岗位相关证据，分歧由授权人复核并保留复核结果。",
      "Assess job tasks through knowledge, practice, and exceptions using job-relevant evidence; authorized reviewers resolve and record disagreements.",
    ],
    [
      "每道题给出工作背景、可选行动和决策约束，评分解释比较各选项后果；避免依赖受测者未获得的内部信息，保留参考依据供复核。",
      "Provide context, choices, and decision constraints, explaining consequences and citing reviewable sources without relying on information unavailable to candidates.",
    ],
    [
      "将产品特性、适用条件和常见误用映射到题目，答案引用指定版本资料；尚未发布或未经证实的功能不写为事实，资料更新后重新校题。",
      "Map features, applicability, and misuse to a specified product version; exclude unverified features and review questions when source materials change.",
    ],
    [
      "制定操作环境、初始状态、观察点及分步得分，安全操作和结果正确分别评分；设备或账号不可用时记录重测条件。",
      "Define environment, starting state, observation points, and step scores, separating safety from correctness and documenting retest conditions.",
    ],
    [
      "分别呈现本人、同事与主管反馈并注明样本量，聚焦可观察行为；小样本不公布可识别原话，也不自动推断绩效。",
      "Present self, peer, and manager feedback with sample counts and observable behaviors; suppress identifying small-group quotes and avoid automatic performance conclusions.",
    ],
    [
      "分别询问内容相关性、节奏、讲师支持和后续应用意愿，设置不适用选项；满意度结果不能单独证明技能提升，并记录调查样本范围。",
      "Ask about relevance, pace, support, and application with a not-applicable option; disclose the sample and do not equate satisfaction with learning.",
    ],
    [
      "按学习目标列题型、难度、题量和分值矩阵，检查每项重要目标均有覆盖；公开答案与保密题库分开管理，评分标准须由出题负责人复核。",
      "Map objectives to item type, difficulty, count, and points, separating public answers and protected banks and requiring review of scoring criteria.",
    ],
    [
      "以试用期目标和已观察成果为依据记录反馈、支持需求及下一步，缺少证据的评价留待主管补充，不自动决定去留。",
      "Assess probation goals and observed outcomes with feedback, support needs, and next steps; leave unsupported judgments open and do not automate employment decisions.",
    ],
    [
      "按客户需求识别、产品表述、异议回应及下一步评分，保留角色扮演记录；不能以虚构成交或个人风格代替行为证据，反馈聚焦可改进动作。",
      "Score discovery, product explanation, objections, and next steps using role-play evidence, giving actionable feedback rather than judging personal style.",
    ],
    [
      "对照目标能力与已验证表现定位缺口，区分知识不足、工具限制和流程障碍，为每个差距提出练习与复测方式，并指定复测日期。",
      "Compare target competencies with demonstrated performance, separating knowledge, tool, and process gaps and assigning practice and retest dates.",
    ],
    [
      "保留原评分、申诉理由、证据和复审人决定，检查评分规则是否一致；更正结果应有授权记录且不抹去原始记录，通知当事人复审结果。",
      "Preserve scores, appeals, evidence, and review decisions; check scoring, authorize corrections, and notify the participant without erasing history.",
    ],
  ],
  "policy-rollout": [
    [
      "用票据、额度、预借款和提交时限示例解释新旧政策差异，标注生效日及历史单据适用规则，例外由财务确认。",
      "Explain receipt, limit, advance, and deadline changes with the effective date and treatment of earlier claims; finance confirms exceptions.",
    ],
    [
      "围绕钓鱼邮件、设备锁屏、敏感资料共享与事件上报设计练习，引用正式安全政策，不要求学员暴露真实密码。",
      "Use phishing, device locking, sensitive sharing, and incident-reporting exercises based on approved policy without requesting real passwords.",
    ],
    [
      "按数据类别解释保留期限、责任人和删除申请流程，法律冻结与备份例外单独说明；实际清理状态需系统管理员核实。",
      "Explain retention by data class, owner, and deletion request, separating legal holds and backup exceptions; administrators verify actual cleanup.",
    ],
    [
      "区分适用岗位、到岗安排、协作时间及例外审批，使用可访问的联系渠道；个人健康信息不进入公开安排，变更后的覆盖班次须核对。",
      "Explain eligible roles, attendance, overlap hours, and exception approval; protect health information and check coverage after schedule changes.",
    ],
    [
      "用一笔典型申请展示发起、审核、退回和升级路径，列不同金额对应的审批角色，旧流程停用日期需以正式公告为准并注明咨询入口。",
      "Illustrate initiation, review, return, and escalation, mapping approval roles to amounts and citing the transition date and contact channel.",
    ],
    [
      "将接诉、分类、调查、答复和回访分成学习步骤，明确紧急升级与赔付授权；案例去标识且不将练习当作真实闭环，并标出记录责任人。",
      "Teach intake, classification, investigation, response, and follow-up with escalation, compensation authority, and record owners; anonymize examples.",
    ],
    [
      "对照采购金额、品类与职责展示授权矩阵，解释拆分采购和利益冲突的上报路径，例外授权须由指定人员确认并记录有效期。",
      "Show authority by amount, category, and role, including split-order and conflict reporting; designated approvers confirm exception duration.",
    ],
    [
      "通过邮件转发、外部协作和离职交接案例复习保密边界，标明信息分级、授权联系人及发生误发后的报告动作和时限。",
      "Use forwarding, external collaboration, and departure cases to review classification, authorized contacts, and misdirection reporting deadlines.",
    ],
    [
      "说明字幕、替代文字、会议参与和材料可读性责任，安排残障同事可选择的反馈渠道，不要求公开个人障碍信息。",
      "Explain captions, alternative text, meeting participation, and readable materials with optional feedback channels that protect personal disability information.",
    ],
    [
      "按修订前后流程、责任变化和过渡日期制作对照，提供旧版受影响作业的确认清单；培训完成不等于流程已生效，实际启用日期须核实。",
      "Compare old and revised workflows, ownership, and transition dates; training completion does not prove activation, so verify the actual start date.",
    ],
    [
      "覆盖行前审批、紧急联系人、当地风险和突发事件联络，并注明信息适用日期；行程及健康资料只在授权范围处理，过期资料重新确认。",
      "Cover approval, contacts, destination risks, and incident communication with dated sources; limit access and refresh stale information.",
    ],
    [
      "按岗位列必读制度、可访问版本、答疑渠道和签收期限；未签收者保持待跟进，签收只证明收到而非完全理解，补签应记录日期。",
      "List required policies, accessible versions, questions, and acknowledgment dates; track late acknowledgments without treating receipt as comprehension.",
    ],
  ],
  "forms-survey": [
    [
      "设置场次选择、必要联系信息和取消方式，说明人数上限与通知时间；表单提交后仍需人工确认名额，超额报名按公开规则处理。",
      "Collect session choice, necessary contact details, and cancellation method, stating capacity and notification time; handle oversubscription under published rules.",
    ],
    [
      "围绕实际岗位任务、当前困难、期望主题及可参加时段提问，按岗位分组分析时设最低样本数，避免识别个人，并保留其他主题选项。",
      "Ask about tasks, difficulties, topics, and availability with an other option; use minimum group sizes to reduce identification risk.",
    ],
    [
      "将响应速度、问题解决和沟通体验分为独立题目，量表标注时间范围并允许不适用；样本偏差需在汇总中说明并注明有效答卷数。",
      "Separate speed, resolution, and communication questions with a defined period and not-applicable option; disclose sample bias and valid responses.",
    ],
    [
      "每个选项写完整日期、时区、起止时刻和跨日情况，允许多选及全部不可用；汇总后仍需人工发送正式邀请并核对夏令时与当地节假日。",
      "Show dates, zones, times, and date crossings; allow multiple choices or no availability, verify daylight saving and local holidays, and send invitations separately.",
    ],
    [
      "按入职前、首周和首月设置问题及未经历跳转，反馈用于流程改进；小团队汇总前检查匿名承诺是否能兑现。",
      "Route questions by preboarding, week one, and month one with skip paths, and verify that small-group reporting can support any anonymity claim.",
    ],
    [
      "设置议程、场地、签到和无障碍体验的简短题目，并给开放建议留空间；现场满意度不能替代后续效果评估，未参加场次允许跳过。",
      "Use brief agenda, venue, registration, and accessibility questions with open feedback and skip paths; immediate satisfaction does not prove outcomes.",
    ],
    [
      "先问用户近期任务和遇到的困难，再中性比较功能选项与优先级；需求意向、付费意愿和实际采用分别验证，并保留不需要选项。",
      "Ask about recent tasks and difficulties before comparing features neutrally with a not-needed option; validate interest, willingness to pay, and adoption separately.",
    ],
    [
      "按采购类别收集主体资质、交付能力、覆盖区域和授权联系人，设置证照有效期及附件要求；资格需人工核验。",
      "Collect entity credentials, delivery capacity, coverage, and contacts by purchase category, including expiry and attachments for manual verification.",
    ],
    [
      "分开询问工具可用性、协作障碍和办公环境，敏感问题允许跳过；部门人数过少时不展示可识别分组结果，并说明结果使用范围。",
      "Ask separately about tools, collaboration, and workplace conditions; allow skips, suppress identifiable small groups, and disclose intended use.",
    ],
    [
      "每题对应课程目标、标准答案、分值及解释，区分单选和多选计分；未经配置和测试不得宣称表单可自动批改，答案版本须复核。",
      "Map items to objectives, answers, scores, and explanations; review answer versions and do not claim untested automatic grading.",
    ],
    [
      "记录候补顺序、可参加场次、联系授权和退出方式，明确递补通知期限；重复报名和过期回复按公开规则人工处理并留处理记录。",
      "Record order, sessions, contact consent, withdrawal, and offer deadlines; manually handle and log duplicates and expired replies.",
    ],
    [
      "围绕协作、交付、阻塞和改进措施设置开放与量表题，允许提出反面意见；根据实际配置说明匿名和结果使用范围。",
      "Combine open and scale questions on collaboration, delivery, blockers, and improvements, allowing dissent and accurately describing anonymity and use.",
    ],
  ],
};

function defineFamily(input: FamilyInput): CreativeExtendedFamily {
  const { audience, sections, scenarios, ...family } = input;
  return {
    ...family,
    sections: sections.map(([zh, en], index) => [
      `section-${index + 1}`,
      zh,
      en,
      `围绕${zh}梳理可核对的信息、责任分工与待决定事项。`,
      `Document verifiable information, ownership, and unresolved decisions for ${en}.`,
    ]),
    acceptance: [
      [
        "内容与提供的来源一致，事实、假设和待确认事项分别标注，不能编造批准或外部动作。",
        "The content matches supplied evidence and distinguishes facts, assumptions, and open questions without inventing approvals or external actions.",
      ],
      [
        "角色、期限、例外和后续责任明确，敏感信息与授权范围经过人工核对。",
        "Roles, dates, exceptions, and next owners are explicit, and sensitive information and permissions receive human review.",
      ],
      [
        "交付可编辑文件，核对章节、表格和引用；实际未执行的发布、发送或系统配置应明确披露。",
        "Deliver an editable file, checking sections, tables, and references; disclose any publishing, sending, or configuration that was not performed.",
      ],
    ],
    workflow: [
      [
        "确认读者、适用场景、目标格式、截止时间和当前证据，登记权限或材料缺口。",
        "Confirm audience, use case, format, deadline, and evidence, recording missing permissions or materials.",
      ],
      [
        "整理来源与版本，确定责任、判断规则和例外，再按场景结构起草可执行内容。",
        "Organize sources and versions, establish owners, decision rules, and exceptions, then draft the scenario-specific content.",
      ],
      [
        "用真实输入检查交付内容，审阅敏感信息、歧义、错误引用和待批准事项。",
        "Check the draft against real inputs and review sensitive information, ambiguity, references, and pending approvals.",
      ],
      [
        "保存可编辑成果并进行内容回读；有条件时检查渲染效果，记录未验证项与人工后续。",
        "Save and read back the editable deliverable; inspect rendered output when available and record unverified items and human next steps.",
      ],
    ],
    scenarios: scenarios.map(
      ([name, focus, inputs, output, risk], index): CreativeAuthoredScenario => {
        const detail = SCENARIO_DETAILS[input.id]?.[index];
        if (!detail) throw new Error(`Missing scenario detail for ${input.id} at ${index}`);
        return {
          name,
          audience,
          brief: { focus, output, risk },
          focus: [`${focus[0]}。${detail[0]}`, `${focus[1]}. ${detail[1]}`],
          inputs,
          output,
          risk,
        };
      },
    ),
  };
}

export const EXTENDED_CREATIVE_FAMILIES_C: readonly CreativeExtendedFamily[] = [
  defineFamily({
    id: "outlook-email",
    name: ["邮件协作", "Email collaboration"],
    category: "document",
    format: "DOCX",
    summary: [
      "起草可审核的邮件与线程跟进材料，保留收件人、行动和证据边界",
      "Draft reviewable email and thread follow-up materials with clear recipients, actions, and evidence",
    ],
    style: [
      "主题明确、语气得体、行动可执行；以可编辑文稿交付",
      "Use a specific subject, appropriate tone, and actionable requests in an editable draft",
    ],
    sections: [
      ["邮件目的", "Purpose"],
      ["收件人与背景", "Recipients and context"],
      ["主题与正文", "Subject and body"],
      ["附件与引用", "Attachments and references"],
      ["行动与期限", "Actions and deadlines"],
      ["发送前复核", "Pre-send review"],
    ],
    audience: [
      "业务经办人、邮件审核人和收件方",
      "Business owners, email reviewers, and recipients",
    ],
    playbook: {
      inputs: [
        "收集往来邮件、发件人身份、收件人与抄送关系、沟通目的、已有承诺、相关附件、截止时间和对方时区。确认事实来源及联系人授权，区分原线程事实和拟议措辞；缺少地址、金额或决定时明确留待补充，不虚构联系人。",
        "Collect the correspondence, sender identity, recipients and copies, purpose, prior commitments, attachments, deadline, and time zone. Confirm sources and contact authorization, separate thread facts from proposed language, and leave unknown addresses, amounts, and decisions unresolved.",
      ],
      method: [
        "先判断邮件是通知、请求、确认、催办还是升级，再按收件人责任安排标题、背景、具体事项、回复期限和下一步。引用原话或附件时核对版本，涉及合同承诺、发送范围和敏感事项先交授权负责人审核，不自动代表用户发信。",
        "Identify whether the email notifies, requests, confirms, follows up, or escalates. Arrange the subject, context, specific request, response date, and next action for each recipient; verify quoted versions and route commitments or sensitive matters to an authorized reviewer without sending on the user's behalf.",
      ],
      design: [
        "在可编辑文档中分别列出建议主题、收件人角色、正文、附件清单及待确认项；段落简短，一段只处理一个意思，必要时使用清晰列表和日期时区。外部邮件与内部备注分区，避免把内部审批意见带给外部收件人。",
        "In an editable document, separate the proposed subject, recipient roles, message, attachment list, and open questions. Use short single-purpose paragraphs and explicit dates and time zones; separate internal notes from external copy so approval comments are not exposed.",
      ],
      checks: [
        "逐项复核称谓、地址角色、回复期限、附件名称和来源版本，检查金额、承诺以及历史邮件引用是否得到证实。特别检查回复全部和密送场景的隐私边界；仅交付邮件草稿及跟踪清单，未实际发送时不得显示已送达。",
        "Check salutations, recipient roles, response dates, attachment names, source versions, numbers, commitments, and quotations. Review reply-all and blind-copy privacy; deliver only a draft and follow-up list and never claim delivery without sending evidence.",
      ],
    },
    scenarios: [
      [
        ["供应商报价跟进", "Supplier quotation follow-up"],
        [
          "按询价范围和有效期逐项催办报价并明确回复日",
          "Follow up on quotation scope and validity with a specific response date",
        ],
        [
          "询价单号、商品规格、报价截止日与供应商联系人",
          "RFQ number, specifications, quotation deadline, and supplier contact",
        ],
        [
          "形成含报价缺项清单和回复方式的礼貌邮件",
          "Draft a courteous email listing missing quote items and response method",
        ],
        [
          "未报价项目不估算价格，避免披露其他供应商报价",
          "Do not estimate missing prices or disclose competing supplier quotations",
        ],
      ],
      [
        ["面试时间邀请", "Interview scheduling invitation"],
        [
          "按面试轮次和参与人的可用时间提出候选时段",
          "Offer interview slots appropriate to the stage and participants' availability",
        ],
        [
          "岗位名称、面试轮次、候选人称谓、可用时间和地点",
          "Role, interview stage, candidate salutation, available times, and location",
        ],
        [
          "形成包含确认方式和必要无障碍安排的邀请草稿",
          "Draft an invitation with confirmation and accessibility arrangements",
        ],
        [
          "不得公开候选人名单或保证尚未确认的录用结果",
          "Protect candidate identities and avoid promising an unconfirmed hiring outcome",
        ],
      ],
      [
        ["催交材料邮件", "Missing-material reminder"],
        ["按材料清单、责任人和到期日追踪未交项", "Follow missing materials by owner and due date"],
        [
          "材料清单、原定日期、已收到版本和提交渠道",
          "Required materials, original dates, received versions, and submission channel",
        ],
        [
          "草拟逐项列明缺口和安全提交方式的提醒",
          "Draft a reminder listing missing items and a secure submission method",
        ],
        [
          "不把未收到视为对方拒绝，避免要求通过不安全渠道发送敏感资料",
          "Do not interpret nonreceipt as refusal or request sensitive material through an unsafe channel",
        ],
      ],
      [
        ["客户续约提醒", "Customer renewal reminder"],
        [
          "对照现有合同结束日和通知期限提出续约讨论",
          "Open a renewal discussion against the existing end and notice dates",
        ],
        [
          "合同编号、到期日、续约选项、联系人及授权报价",
          "Contract ID, expiration, renewal options, contact, and approved pricing",
        ],
        [
          "准备区分现有约定与待商议选项的续约邮件",
          "Prepare a renewal message separating existing terms from options",
        ],
        [
          "未经批准不保证续约价格或将自动续约条件写成确定事实",
          "Do not promise unapproved prices or assert unverified automatic-renewal terms",
        ],
      ],
      [
        ["项目状态周报邮件", "Project status email"],
        [
          "按已完成、进行中、阻塞和下周行动汇总",
          "Summarize completed work, progress, blockers, and next-week actions",
        ],
        [
          "报告周期、里程碑状态、风险责任人和支持请求",
          "Reporting period, milestone status, risk owners, and support requests",
        ],
        [
          "输出带决策请求和负责人日期的状态邮件",
          "Produce a status email with decision requests, owners, and dates",
        ],
        [
          "区分事实进度和预计日期，避免遗漏关键依赖",
          "Separate actual progress from projected dates and preserve critical dependencies",
        ],
      ],
      [
        ["多时区会议协调", "Cross-time-zone meeting coordination"],
        [
          "比较参与者工作时间并提供可选会议时段",
          "Compare participants' working hours and propose meeting slots",
        ],
        [
          "参加人时区、夏令时规则、可用窗口和会议时长",
          "Participant time zones, daylight-saving rules, availability, and duration",
        ],
        [
          "制作标有日期和时区的候选时间及确认邮件",
          "Draft candidate dates and times with explicit time zones and confirmation",
        ],
        [
          "避免跨日和夏令时换算错误，尚未确认的时段不称为已预约",
          "Check date boundaries and daylight-saving conversions; do not call an unconfirmed slot booked",
        ],
      ],
      [
        ["错误邮件更正", "Correction to a prior email"],
        [
          "指出需更正的具体内容并说明正确版本及影响",
          "Identify the precise error, correction, and consequences",
        ],
        [
          "原邮件日期、错误段落、经核实的新内容和收件范围",
          "Original date, erroneous passage, verified correction, and recipients",
        ],
        [
          "生成简洁更正邮件和需重新发送附件的清单",
          "Produce a concise correction and list any attachments requiring replacement",
        ],
        [
          "不得掩盖重要错误或将未经核实的新信息当成更正",
          "Do not conceal material errors or present unverified information as a correction",
        ],
      ],
      [
        ["客户投诉升级邮件", "Customer complaint escalation"],
        [
          "按影响、已处理事项和所需授权组织升级",
          "Escalate using impact, completed actions, and required authority",
        ],
        [
          "投诉编号、时间线、客户诉求、证据与当前处理人",
          "Complaint ID, timeline, customer request, evidence, and current owner",
        ],
        [
          "输出内部升级邮件及拟向客户确认的下一步",
          "Draft the internal escalation and proposed customer-facing next step",
        ],
        [
          "不泄露不必要个人信息或承诺未经批准的赔付",
          "Minimize personal information and do not promise unapproved compensation",
        ],
      ],
      [
        ["临时缺席自动回复文案", "Temporary absence auto-reply copy"],
        [
          "说明缺席期间、替代联系人和预计恢复回复时间",
          "State absence dates, an alternate contact, and expected response resumption",
        ],
        [
          "缺席起止、覆盖范围、授权替代人及紧急渠道",
          "Absence dates, coverage, authorized alternate, and urgent channel",
        ],
        [
          "分别准备内部和外部自动回复文案供人工设置",
          "Prepare separate internal and external auto-reply copy for manual setup",
        ],
        [
          "外部版本不暴露旅行细节，不声称自动回复已启用",
          "Do not disclose travel details externally or claim an auto-reply is enabled",
        ],
      ],
      [
        ["合同会签邮件", "Contract approval routing email"],
        [
          "按会签顺序明确每位审阅人的审查范围和期限",
          "State each reviewer's scope and deadline in the approval sequence",
        ],
        [
          "合同版本、条款清单、审批矩阵和待决差异",
          "Contract version, clause list, approval matrix, and unresolved changes",
        ],
        [
          "草拟列明版本链接或附件及反馈格式的会签请求",
          "Draft a routing request with the version reference, attachment, and feedback format",
        ],
        [
          "无审阅回复不视为批准，避免发送过期或错误合同版本",
          "Do not infer approval from silence or circulate an outdated contract",
        ],
      ],
      [
        ["会议后行动跟进邮件", "Post-meeting action follow-up"],
        [
          "将实际决定与待定事项分开，并逐项跟踪行动",
          "Separate actual decisions from open questions and track each action",
        ],
        [
          "会议纪要、行动责任人、期限和约定交付物",
          "Meeting minutes, action owners, deadlines, and agreed deliverables",
        ],
        [
          "整理行动表及需收件人确认的跟进邮件",
          "Prepare an action list and a follow-up email requesting confirmation",
        ],
        [
          "不把未确认的讨论意见写成集体决议",
          "Do not turn unconfirmed discussion points into collective decisions",
        ],
      ],
      [
        ["邮件线程归档规范", "Email thread archiving procedure"],
        [
          "按主题、项目和保留规则定义可检索的归档方式",
          "Define searchable archiving by topic, project, and retention rule",
        ],
        [
          "线程范围、附件清单、保留期限、访问角色及命名规则",
          "Thread scope, attachments, retention period, access roles, and naming rules",
        ],
        [
          "交付线程索引与人工归档步骤，保留来源引用",
          "Deliver a thread index and manual archiving steps with source references",
        ],
        [
          "遵循保留和隐私要求，不假称已移动邮箱或删除邮件",
          "Respect retention and privacy rules without claiming messages were moved or deleted",
        ],
      ],
    ],
  }),
  defineFamily({
    id: "onenote-notes",
    name: ["知识笔记", "Knowledge notes"],
    category: "document",
    format: "DOCX",
    summary: [
      "为知识笔记设计可追溯的页面结构、链接和维护动作",
      "Design traceable note pages, references, and maintenance actions",
    ],
    style: [
      "主题分层、结论先行、来源清晰，交付离线笔记文稿",
      "Use layered topics, conclusions first, and clear sources in an offline note document",
    ],
    sections: [
      ["主题与用途", "Topic and purpose"],
      ["来源与可信度", "Sources and confidence"],
      ["关键事实", "Key facts"],
      ["分类与关联", "Categories and links"],
      ["任务及维护", "Tasks and maintenance"],
      ["待核实事项", "Open questions"],
    ],
    audience: [
      "知识维护者、项目成员及授权读者",
      "Knowledge maintainers, project members, and authorized readers",
    ],
    playbook: {
      inputs: [
        "收集已有笔记、访谈记录、文档链接、图片来源、作者、创建与更新日期以及目标读者。识别可公开和受限资料，记录每份来源的版本与证据强度；无法访问或缺失的文件列为待补，不把推测写成原始记录。",
        "Gather existing notes, interviews, document references, image provenance, authors, dates, and target readers. Classify public and restricted material, record source versions and evidence strength, and flag inaccessible inputs instead of presenting assumptions as records.",
      ],
      method: [
        "依据工作主题设计笔记本、分区与页面的人工映射，先提炼结论，再区分事实、解释、未决问题和下一步。对跨页引用保留标题与来源位置，为决策记录保留时间和负责人；同步状态不明的内容应先人工复核。",
        "Map notebooks, sections, and pages by work topic, starting with conclusions and separating facts, interpretations, questions, and next steps. Retain source locations and dated decision owners; manually verify any content whose synchronization state is unknown.",
      ],
      design: [
        "以可编辑文稿组织页面目录、统一标题层级、来源摘要、任务列表及维护日期，链接应使用实际提供的地址而不是编造路径。长表格保持可读列宽，来源与待核实标签固定位置；输出是导入参考材料而非原生笔记本。",
        "Organize an editable document with a page index, heading hierarchy, source summaries, task lists, and maintenance dates, using only supplied links. Keep tables readable and place source and uncertainty labels consistently; deliver import-reference material, not a native notebook.",
      ],
      checks: [
        "核对索引与正文对应、链接目标存在且权限合适、引用内容未脱离原文语境，检查个人信息和过期记录。对需人工迁移、离线附件和无法验证的同步状态逐项说明；不声称已创建页面、共享笔记本或完成同步。",
        "Check index-to-content consistency, accessible link targets, source context, personal data, and stale entries. Explain manual migration, offline attachments, and unverified sync state; do not claim pages, sharing, or synchronization were completed.",
      ],
    },
    scenarios: [
      [
        ["新项目知识库索引", "New project knowledge index"],
        [
          "按项目阶段梳理页面、关键文档与负责人的入口",
          "Organize pages, key documents, and owners by project phase",
        ],
        [
          "项目章程、里程碑、成员名单与现有文档位置",
          "Project charter, milestones, member list, and existing document locations",
        ],
        [
          "形成页面目录、来源映射和后续维护表",
          "Create a page index, source map, and maintenance register",
        ],
        [
          "未建立的链接标记待建，不能假定所有成员均有访问权",
          "Mark uncreated links and do not assume universal access",
        ],
      ],
      [
        ["客户交接知识笔记", "Customer handover notes"],
        [
          "提炼客户背景、服务约定、未结事项及交接责任",
          "Summarize customer context, service terms, open issues, and handover ownership",
        ],
        [
          "客户授权资料、合同范围、工单和历史沟通记录",
          "Authorized customer material, contract scope, tickets, and correspondence",
        ],
        [
          "编写可核验的交接页面和待确认清单",
          "Draft a verifiable handover page and confirmation checklist",
        ],
        [
          "避免复制无关个人信息或将非正式承诺当作合同条款",
          "Exclude unnecessary personal data and do not treat informal promises as contract terms",
        ],
      ],
      [
        ["研究主题笔记", "Research topic notes"],
        [
          "围绕研究问题区分证据、观点与反例",
          "Separate evidence, interpretation, and counterexamples around a research question",
        ],
        [
          "研究问题、参考材料、作者、日期和摘录位置",
          "Research question, references, authors, dates, and excerpt locations",
        ],
        [
          "制作主题摘要、引用索引及证据缺口",
          "Prepare a topic summary, source index, and evidence gaps",
        ],
        [
          "引用保留语境，不将无来源观点写成结论",
          "Preserve quotation context and do not promote unsourced opinion to fact",
        ],
      ],
      [
        ["故障排查知识笔记", "Troubleshooting knowledge notes"],
        [
          "依据症状、环境和验证结果组织排查路径",
          "Organize diagnosis around symptoms, environment, and verified outcomes",
        ],
        [
          "报错信息、系统版本、已尝试步骤和处理记录",
          "Error messages, system versions, attempted steps, and incident records",
        ],
        [
          "整理症状索引、检查条件和已验证的恢复步骤",
          "Produce a symptom index, checks, and verified recovery steps",
        ],
        [
          "高风险操作先列审批和备份，未验证命令不得标记可用",
          "Require approval and backups for risky steps and label unverified commands",
        ],
      ],
      [
        ["新员工入职笔记", "New hire onboarding notes"],
        [
          "按入职阶段安排联系人、系统申请和学习资料",
          "Arrange contacts, access requests, and learning by onboarding stage",
        ],
        [
          "入职计划、岗位职责、申请流程及授权资料",
          "Onboarding plan, role duties, request procedures, and authorized resources",
        ],
        ["制作分阶段笔记目录及完成状态清单", "Create a phased note index and completion checklist"],
        [
          "不得放入密码或把待审批权限写成已开通",
          "Do not include passwords or describe pending access as granted",
        ],
      ],
      [
        ["销售访谈笔记", "Sales interview notes"],
        [
          "分离客户原话、需求判断、购买条件和待跟进事项",
          "Separate customer statements, interpreted needs, buying criteria, and follow-up",
        ],
        [
          "访谈日期、授权记录、客户角色及沟通要点",
          "Interview date, consent, customer role, and discussion notes",
        ],
        [
          "形成客户需求摘要、证据摘录和后续问题",
          "Produce a needs summary, evidence excerpts, and follow-up questions",
        ],
        [
          "敏感客户资料按授权收集，预测成交不能写成事实",
          "Handle sensitive customer information under consent and do not assert predicted sales",
        ],
      ],
      [
        ["每周学习复盘笔记", "Weekly learning review"],
        [
          "归纳学习目标、实际练习和可迁移的工作成果",
          "Relate learning objectives to practice and transferable work results",
        ],
        [
          "学习记录、练习材料、反馈及下周可用时间",
          "Learning logs, exercises, feedback, and next week's available time",
        ],
        [
          "输出知识摘要、应用例子与下周练习计划",
          "Produce a knowledge summary, application examples, and next-week practice plan",
        ],
        [
          "区分已掌握技能与自我估计，未实践内容保留待验证",
          "Separate demonstrated skills from self-estimates and flag untested material",
        ],
      ],
      [
        ["产品需求访谈笔记", "Product discovery interview notes"],
        [
          "将用户原话映射到任务、痛点和待验证假设",
          "Map user statements to tasks, pain points, and testable assumptions",
        ],
        [
          "访谈脚本、受访者角色、观察记录与产品边界",
          "Interview guide, participant role, observations, and product scope",
        ],
        [
          "交付需求主题索引、证据和后续验证问题",
          "Deliver a theme index, evidence, and validation questions",
        ],
        [
          "匿名化敏感表述，不因少量访谈推断整体比例",
          "Anonymize sensitive statements and do not infer population rates from a few interviews",
        ],
      ],
      [
        ["文献阅读摘录", "Literature reading excerpts"],
        [
          "记录论点、方法、适用条件与可复核出处",
          "Record claims, methods, applicability, and verifiable sources",
        ],
        [
          "文献标题、作者、发表时间、页码与原始段落",
          "Title, author, publication date, page, and source passage",
        ],
        [
          "制作文献卡片、摘要及不同结论的对照",
          "Create reading cards, summaries, and a comparison of differing findings",
        ],
        [
          "不得编造页码或扩大原研究的结论范围",
          "Do not invent page references or overstate the original study",
        ],
      ],
      [
        ["制度版本摘录", "Policy version notes"],
        [
          "对照适用日期提取制度条款与变更点",
          "Extract policy terms and changes against effective dates",
        ],
        [
          "正式制度、版本号、批准记录和历史版本",
          "Approved policy, version, approval record, and earlier versions",
        ],
        [
          "编写版本索引及变更摘要并引用原条款",
          "Prepare a version index and change summary linked to original clauses",
        ],
        [
          "旧版本不得误标现行，缺少批准记录须提示",
          "Do not label old versions current; flag missing approval records",
        ],
      ],
      [
        ["项目决策日志", "Project decision log"],
        [
          "按决策日期记录方案、依据、责任人与复审条件",
          "Log options, rationale, owner, and review trigger by decision date",
        ],
        [
          "会议纪要、方案比较、决策授权及未决问题",
          "Minutes, option comparisons, decision authority, and open questions",
        ],
        [
          "生成可追溯决策目录和后续变更记录",
          "Generate a traceable decision index and subsequent change log",
        ],
        [
          "区分建议与正式决定，撤销决定应保留历史",
          "Separate recommendations from decisions and preserve reversed decisions",
        ],
      ],
      [
        ["知识库迁移映射", "Knowledge base migration map"],
        [
          "按原路径、目标分类和负责人规划人工迁移",
          "Plan manual migration using source paths, target categories, and owners",
        ],
        [
          "源目录、页面清单、权限、附件和目标结构",
          "Source directories, page inventory, permissions, attachments, and target structure",
        ],
        [
          "交付迁移映射、缺失附件和验收清单",
          "Deliver a migration map, missing-attachment list, and acceptance checklist",
        ],
        [
          "不得在未验证前声称链接、权限或同步已迁移",
          "Do not claim links, permissions, or synchronization were migrated without verification",
        ],
      ],
    ],
  }),
  defineFamily({
    id: "teams-collaboration",
    name: ["团队协作沟通", "Team collaboration"],
    category: "operations",
    format: "DOCX",
    summary: [
      "规划会议、频道、交接与异步协作的人工实施材料",
      "Plan meetings, channels, handovers, and asynchronous collaboration for human implementation",
    ],
    style: [
      "角色清晰、信息有出处、讨论结果可追踪",
      "Keep roles explicit, information sourced, and discussion outcomes traceable",
    ],
    sections: [
      ["协作目标", "Collaboration goals"],
      ["参与人与职责", "Participants and roles"],
      ["频道与会议", "Channels and meetings"],
      ["消息及文件", "Messages and files"],
      ["行动与升级", "Actions and escalation"],
      ["权限及归档", "Permissions and archiving"],
    ],
    audience: [
      "团队负责人、协作成员及信息管理员",
      "Team leads, collaborators, and information administrators",
    ],
    playbook: {
      inputs: [
        "收集团队目标、成员角色、项目周期、现有频道、会议节奏、文件权限和重要决策记录，注明跨组织成员及其授权范围。确认时区、联系人和组织政策，缺少的名单或访问权限应保留待核实，不以示例代替实际成员。",
        "Gather team goals, member roles, project dates, existing channels, meeting cadence, file permissions, and decisions, including cross-organization access. Verify time zones, contacts, and policy; leave missing membership or permissions open rather than inventing people.",
      ],
      method: [
        "根据任务的同步或异步性质确定频道、会议、决策记录和升级路径，给每项讨论指定负责人、回复期限与决议出口。涉及外部成员或敏感附件时先确认组织策略，再由具备权限的人员手动配置；不假定集成服务已经启用。",
        "Choose channels, meetings, decision records, and escalation paths according to synchronous or asynchronous needs, assigning owners and response dates. Check policy before involving outsiders or sensitive attachments; authorized staff must perform configuration and integrations are not presumed active.",
      ],
      design: [
        "在文档中用一页协作地图展示团队、频道、会议和文档位置，再以表格列消息类型、责任角色、响应预期及保留期限。使用实际提供的链接与名称，明确离线规格和待人工设置的边界，不把文稿包装成已创建的团队空间。",
        "Use a one-page collaboration map of teams, channels, meetings, and document locations, followed by message types, owners, response expectations, and retention periods. Use supplied links and identify the offline specification and manual setup; do not present the document as a created workspace.",
      ],
      checks: [
        "检查每个角色是否拥有批准权限、公开频道是否误放敏感资料、行动是否有负责人和期限，以及跨时区时间是否含日期和时区。对外部共享、录制、自动通知与归档状态逐项人工确认，未实际设置或发送时如实说明。",
        "Check role authority, sensitive material in open channels, action owners and deadlines, and dates with time zones. Require human confirmation of external sharing, recordings, notifications, and archiving; disclose anything not actually configured or sent.",
      ],
    },
    scenarios: [
      [
        ["跨部门项目频道规划", "Cross-functional channel plan"],
        [
          "按工作流和信息敏感度分组讨论频道",
          "Group discussion channels by workflow and sensitivity",
        ],
        [
          "项目职责、团队名单、工作流与权限规则",
          "Project roles, team members, workflows, and access policy",
        ],
        [
          "交付频道用途、成员角色和命名清单",
          "Deliver channel purposes, roles, and naming conventions",
        ],
        [
          "私密讨论不能默认放入全员可见区域",
          "Do not place confidential discussion in a generally visible area",
        ],
      ],
      [
        ["项目启动会协作安排", "Project kickoff collaboration plan"],
        [
          "安排会前资料、讨论顺序和启动决定",
          "Schedule pre-reads, discussion order, and kickoff decisions",
        ],
        [
          "章程、目标、参与人、会议时长和依赖",
          "Charter, objectives, attendees, duration, and dependencies",
        ],
        [
          "输出议程、会后行动和资料索引",
          "Produce the agenda, follow-up actions, and document index",
        ],
        [
          "未经确认的负责人不能写成已接受任务",
          "Do not present unconfirmed owners as having accepted assignments",
        ],
      ],
      [
        ["值班轮班交接", "Shift handover coordination"],
        [
          "按交接时间整理未结事件与接班确认",
          "Organize open incidents and incoming-shift confirmation by handover time",
        ],
        [
          "值班表、工单编号、状态、风险与联系方式",
          "Shift roster, ticket IDs, status, risks, and contacts",
        ],
        [
          "生成交班模板、待处理事项和升级联系人",
          "Generate a handover template, open items, and escalation contacts",
        ],
        [
          "未接班确认不得视为责任已转移",
          "Do not assume responsibility transferred without acceptance",
        ],
      ],
      [
        ["会议决策即时记录", "Live meeting decision capture"],
        [
          "区别讨论提案、实际决议和仍需审批事项",
          "Separate proposals, actual decisions, and approval-dependent items",
        ],
        [
          "议题、参会角色、备选方案和表决记录",
          "Topics, participant roles, options, and voting record",
        ],
        ["形成带依据及责任人的决策日志", "Produce a decision log with rationale and owners"],
        [
          "缺席方意见或未经授权的表决不得推定",
          "Do not infer absent participants' positions or unauthorized votes",
        ],
      ],
      [
        ["协作文件权限清单", "Collaborative file access matrix"],
        [
          "梳理各类资料的查看、编辑与批准角色",
          "Map viewing, editing, and approval roles for each material type",
        ],
        [
          "文件分类、成员角色、权限政策和共享范围",
          "File categories, member roles, permission policy, and sharing scope",
        ],
        [
          "交付最小权限矩阵及人工检查步骤",
          "Deliver a least-privilege matrix and manual verification steps",
        ],
        [
          "设计矩阵不等于实际权限已生效",
          "A proposed matrix does not prove permissions were applied",
        ],
      ],
      [
        ["远程主持议程", "Remote meeting facilitation agenda"],
        [
          "按发言顺序与时间盒安排参与和决策",
          "Schedule participation and decisions using a timed speaking order",
        ],
        [
          "会议目标、议题、参会时区和设备条件",
          "Meeting objective, topics, time zones, and equipment constraints",
        ],
        [
          "生成主持脚本、议程及掉线备选安排",
          "Generate a facilitation script, agenda, and disconnection fallback",
        ],
        [
          "会前征得录制授权，不把参会邀请当作录制同意",
          "Obtain recording consent; an invitation is not consent",
        ],
      ],
      [
        ["异步评审征求意见", "Asynchronous review request"],
        [
          "确定评审版本、问题清单与反馈截止日",
          "Fix the review version, questions, and feedback deadline",
        ],
        [
          "待审文档、目标读者、评审标准及回复渠道",
          "Review document, readers, criteria, and response channel",
        ],
        [
          "制作评审请求和逐条意见处置表",
          "Prepare a review request and disposition table for each comment",
        ],
        ["缺席反馈不得自动解释为同意", "Do not interpret missing feedback as agreement"],
      ],
      [
        ["事故升级联络", "Incident escalation coordination"],
        [
          "按事件等级、影响和响应时限确定联络链",
          "Define contact chains by severity, impact, and response time",
        ],
        [
          "事件编号、现象、处置记录和授权联系人",
          "Incident ID, symptoms, response history, and authorized contacts",
        ],
        [
          "输出升级消息、交接信息及状态更新时间",
          "Produce an escalation message, handover details, and update times",
        ],
        [
          "未经证实的根因和恢复时间标明未知",
          "Mark unverified root cause and restoration time as unknown",
        ],
      ],
      [
        ["跨时区协作节奏", "Cross-time-zone collaboration cadence"],
        [
          "在共同工作窗口外设计异步交接及响应规则",
          "Plan asynchronous handoffs and response rules outside shared hours",
        ],
        [
          "成员时区、工作日、例会和服务时限",
          "Member time zones, working days, recurring meetings, and service deadlines",
        ],
        [
          "生成带本地时间的交接表和轮换主持安排",
          "Generate local-time handoffs and a rotating facilitation schedule",
        ],
        [
          "节假日与夏令时变动需逐期复核",
          "Recheck holidays and daylight-saving changes each period",
        ],
      ],
      [
        ["新人团队融入安排", "Team onboarding coordination"],
        [
          "梳理新人参与频道、导师及前两周沟通安排",
          "Arrange onboarding channels, mentor, and first-two-week communications",
        ],
        [
          "岗位、导师、入职计划与必要访问申请",
          "Role, mentor, onboarding plan, and required access requests",
        ],
        [
          "准备欢迎消息草稿和分阶段参与清单",
          "Prepare a welcome draft and phased participation checklist",
        ],
        ["未批准的访问权限不能视为已配置", "Do not treat unapproved access as configured"],
      ],
      [
        ["外部合作群接入", "External partner collaboration access"],
        [
          "界定外部成员可以接触的频道和资料",
          "Define channels and materials accessible to external participants",
        ],
        [
          "合作范围、成员身份、保密约定和期限",
          "Partnership scope, member identities, confidentiality terms, and duration",
        ],
        [
          "提供接入申请、权限矩阵和到期复核表",
          "Provide access requests, permission matrix, and expiry review",
        ],
        [
          "需遵循组织外部共享策略并人工审批",
          "Follow external-sharing policy and obtain human approval",
        ],
      ],
      [
        ["讨论沉淀与归档", "Discussion capture and archiving"],
        [
          "将有价值的决策、文件和未决事项归入主题索引",
          "Index decisions, documents, and open items by topic",
        ],
        [
          "讨论记录、决定、文件链接和保留要求",
          "Discussion records, decisions, document links, and retention requirements",
        ],
        [
          "形成摘要、来源位置及人工归档步骤",
          "Produce a summary, source locations, and manual archiving steps",
        ],
        [
          "保留法律冻结资料，不能声称消息已删除或移动",
          "Preserve legally held content and do not claim messages were moved or deleted",
        ],
      ],
    ],
  }),
  defineFamily({
    id: "sharepoint-information",
    name: ["共享资料信息架构", "Shared information architecture"],
    category: "operations",
    format: "DOCX",
    summary: [
      "设计站点、文档库、元数据与权限的可实施离线规格",
      "Specify sites, libraries, metadata, and permissions for manual implementation",
    ],
    style: [
      "以查找任务和内容生命周期组织结构，不假称已在线发布",
      "Organize around retrieval and content lifecycle without claiming online publication",
    ],
    sections: [
      ["读者与任务", "Readers and tasks"],
      ["站点导航", "Site navigation"],
      ["内容与元数据", "Content and metadata"],
      ["权限与共享", "Permissions and sharing"],
      ["迁移和维护", "Migration and maintenance"],
      ["验收与限制", "Acceptance and limits"],
    ],
    audience: [
      "信息架构师、内容负责人及组织管理员",
      "Information architects, content owners, and organizational administrators",
    ],
    playbook: {
      inputs: [
        "收集现有站点和文档库清单、内容分类、人员角色、检索任务、组织保留政策、外部共享规则及迁移范围。对每类资料记录责任人、敏感等级和来源版本，无法核验的当前权限列为待确认，不推测组织租户配置。",
        "Collect existing sites and libraries, content categories, roles, retrieval tasks, retention policy, external-sharing rules, and migration scope. Record owner, sensitivity, and source version for each class; leave unverified permissions and tenant configuration open.",
      ],
      method: [
        "先基于查找任务确定站点导航，再定义文档库、内容类型、元数据字段、受控词表、权限继承和例外审批。为迁移建立原路径与目标路径映射，明确试点、抽检、回退和内容负责人；任何线上配置均由授权管理员实施。",
        "Design navigation from retrieval tasks, then specify libraries, content types, metadata, controlled terms, inherited permissions, and exception approval. Map source to target locations with pilot, sampling, rollback, and content owners; authorized administrators perform online configuration.",
      ],
      design: [
        "以可编辑文档提供站点树、库与字段字典、角色权限矩阵、示例检索路径和维护责任表；权限、保留和外部共享使用可区分的列，不靠颜色单独表达。设计仅为人工实施规格，不生成原生站点包，也不连接线上租户。",
        "Provide an editable site tree, library and field dictionary, role-permission matrix, example retrieval paths, and ownership register. Distinguish permissions, retention, and sharing in labeled columns rather than color alone; the specification neither generates a site package nor connects to a tenant.",
      ],
      checks: [
        "沿真实用户的查找任务检查导航和字段是否一致，抽查重复命名、敏感资料误共享、空负责人、继承例外及过期内容。迁移前后核对数量和版本，实际权限、生效策略及搜索结果需在目标环境人工验证并如实报告。",
        "Test navigation and fields against real retrieval tasks; inspect duplicate names, inappropriate sharing, missing owners, inheritance exceptions, and stale content. Reconcile migration counts and versions, and have humans verify actual permissions, policies, and search results in the target environment.",
      ],
    },
    scenarios: [
      [
        ["部门站点导航设计", "Department site navigation"],
        [
          "围绕员工高频任务组织首页入口和二级导航",
          "Organize homepage and secondary navigation around frequent employee tasks",
        ],
        [
          "部门服务清单、读者角色、现有页面和检索问题",
          "Department services, reader roles, existing pages, and search questions",
        ],
        ["交付站点树、导航标签和责任人", "Deliver a site tree, navigation labels, and owners"],
        [
          "避免按部门内部组织图替代真实查找路径",
          "Do not substitute an internal organization chart for actual retrieval paths",
        ],
      ],
      [
        ["共享文档库结构", "Shared document library structure"],
        [
          "按文档生命周期和访问要求划分文档库",
          "Partition libraries by document lifecycle and access requirements",
        ],
        [
          "文件清单、类型、敏感级别、数量和使用频率",
          "File inventory, types, sensitivity, volumes, and usage",
        ],
        [
          "设计库结构、命名规则及归档边界",
          "Design library structure, naming rules, and archival boundaries",
        ],
        [
          "深层目录和重复副本应标记迁移风险",
          "Flag deeply nested folders and duplicate copies as migration risks",
        ],
      ],
      [
        ["合同资料权限分层", "Contract material permission tiers"],
        [
          "按合同阶段区分起草、审阅和只读权限",
          "Separate drafting, review, and read-only permissions by contract stage",
        ],
        [
          "合同类型、角色、保密级别及审批矩阵",
          "Contract types, roles, confidentiality levels, and approval matrix",
        ],
        [
          "交付库级权限建议及例外登记",
          "Deliver proposed library permissions and an exception register",
        ],
        [
          "法律保留和外部律师访问须由授权人员核验",
          "Have authorized staff verify legal holds and external counsel access",
        ],
      ],
      [
        ["受控制度发布流程", "Controlled policy publication"],
        [
          "规划起草、审批、生效、废止和历史版本入口",
          "Plan drafting, approval, effective dates, retirement, and historical access",
        ],
        [
          "制度版本、批准角色、生效日期与保留期限",
          "Policy versions, approval roles, effective dates, and retention",
        ],
        [
          "形成发布检查表和版本状态字典",
          "Produce a publication checklist and version-status dictionary",
        ],
        [
          "草案不得与批准的现行制度混排",
          "Do not present drafts alongside approved current policies without distinction",
        ],
      ],
      [
        ["项目文档元数据", "Project document metadata"],
        [
          "为项目文档定义可筛选且稳定的字段",
          "Define stable, filterable fields for project documents",
        ],
        [
          "项目编号、阶段、文档类型、责任人和版本",
          "Project ID, phase, document type, owner, and version",
        ],
        [
          "制作字段字典、必填规则和示例记录",
          "Create a field dictionary, required-field rules, and sample records",
        ],
        [
          "字段命名冲突和空值必须进入清理清单",
          "List naming collisions and missing values for cleanup",
        ],
      ],
      [
        ["知识库搜索筛选", "Knowledge base search refiners"],
        [
          "根据提问方式和内容类型设计筛选维度",
          "Design filters around user questions and content types",
        ],
        [
          "搜索任务、同义词、知识分类和现有标签",
          "Search tasks, synonyms, knowledge categories, and existing tags",
        ],
        [
          "交付搜索词表、筛选规格和人工测试用例",
          "Deliver search terms, filter specifications, and manual test cases",
        ],
        [
          "不能承诺未经配置的搜索排序或索引结果",
          "Do not promise unconfigured search ranking or indexing results",
        ],
      ],
      [
        ["历史资料迁移清单", "Historical content migration inventory"],
        [
          "按价值、重复和保留期限决定迁移或归档",
          "Classify content for migration or archival by value, duplication, and retention",
        ],
        [
          "源路径、文件版本、拥有者、大小及权限",
          "Source paths, versions, owners, sizes, and permissions",
        ],
        [
          "提供源目标映射、抽检和回退清单",
          "Provide source-target mappings, sampling, and rollback checks",
        ],
        [
          "不得在未核对前删除源文件或宣称迁移完成",
          "Do not delete source files or claim completion before reconciliation",
        ],
      ],
      [
        ["内容生命周期归档", "Content lifecycle archiving"],
        [
          "定义活跃、复审、归档和销毁前审批状态",
          "Define active, review, archived, and pre-disposal approval states",
        ],
        [
          "内容类别、更新时间、保留期限与法务要求",
          "Content category, update date, retention, and legal requirements",
        ],
        ["制作生命周期规则及例外复核记录", "Create lifecycle rules and exception-review records"],
        [
          "法律保留优先于普通删除时间表",
          "Legal holds take precedence over ordinary disposal schedules",
        ],
      ],
      [
        ["外部共享审批", "External sharing approval"],
        [
          "根据合作方身份和共享期限确定授权流程",
          "Determine authorization from partner identity and sharing duration",
        ],
        [
          "业务目的、资料分类、外部人员和到期日",
          "Business purpose, content classification, external identities, and expiry",
        ],
        [
          "输出共享审批表、权限建议与撤销检查",
          "Produce an approval form, access recommendation, and revocation checklist",
        ],
        ["不把匿名链接视作默认安全选项", "Do not treat anonymous links as a default safe option"],
      ],
      [
        ["首页公告治理", "Homepage announcement governance"],
        [
          "明确公告发布人、审核人、展示期限与撤稿条件",
          "Define publisher, reviewer, display period, and withdrawal criteria",
        ],
        [
          "公告类型、内容责任人、受众及生效时间",
          "Announcement type, owner, audience, and effective date",
        ],
        [
          "交付公告模板、审批及过期复查表",
          "Deliver an announcement template, approval and expiry review",
        ],
        ["未批准的通知不得标为正式公告", "Do not label an unapproved notice official"],
      ],
      [
        ["文件版本恢复规范", "File version recovery procedure"],
        [
          "定义恢复申请、目标版本核验和结果确认步骤",
          "Define recovery request, target-version validation, and result confirmation",
        ],
        [
          "文件标识、历史版本、修改人和恢复原因",
          "File identifier, version history, editors, and reason for recovery",
        ],
        ["给出人工操作清单及恢复记录模板", "Provide manual steps and a recovery record template"],
        [
          "覆盖现行版本前需备份并确认权限",
          "Back up and verify authority before replacing a current version",
        ],
      ],
      [
        ["法务保留资料登记", "Legal hold content register"],
        [
          "记录法务保留范围、责任人及解除审批条件",
          "Record legal-hold scope, owners, and release authorization",
        ],
        [
          "案件标识、资料位置、保留通知及法务联系人",
          "Matter ID, locations, hold notice, and legal contact",
        ],
        [
          "形成保留清单、检查周期和例外登记",
          "Create a hold register, review cadence, and exception log",
        ],
        [
          "未经法务授权不得解除保留或删除资料",
          "Do not release a hold or delete materials without legal authorization",
        ],
      ],
    ],
  }),
  defineFamily({
    id: "visio-process-spec",
    name: ["流程图绘制规格", "Process diagram specification"],
    category: "operations",
    format: "DOCX",
    summary: [
      "用可编辑文档描述流程节点、泳道与连接规则，供人工绘图",
      "Specify process nodes, swimlanes, and connectors for manual diagramming",
    ],
    style: [
      "节点命名明确、流向清晰，输出绘图规格而非原生流程图文件",
      "Use clear node names and flow direction; deliver a specification, not a native diagram",
    ],
    sections: [
      ["流程边界", "Process boundaries"],
      ["角色与泳道", "Roles and swimlanes"],
      ["节点与输入", "Nodes and inputs"],
      ["判断及连接", "Decisions and connectors"],
      ["例外与记录", "Exceptions and records"],
      ["绘图验收", "Diagram acceptance"],
    ],
    audience: [
      "流程负责人、业务分析师及绘图人员",
      "Process owners, business analysts, and diagram authors",
    ],
    playbook: {
      inputs: [
        "收集业务目标、触发条件、结束状态、岗位职责、现行规则、表单字段和实际异常案例，并确认流程版本、管理责任人与适用范围。对跨部门交接、审批权限和数字化系统状态分别找证据，资料缺失处保留待确认，不推断实际步骤。",
        "Gather objectives, triggers, end states, role responsibilities, current rules, form fields, and exception cases; confirm version, owner, and applicability. Evidence cross-team handoffs, approvals, and system states separately, leaving missing steps unconfirmed.",
      ],
      method: [
        "先确定起点和各终点，再以角色划分泳道，为每个动作编写唯一编号、输入、责任、结果与下一节点。判断节点列明互斥或明确覆盖的条件，拒绝、超时、撤回和升级路径单独建边，复杂子流程标注入口及返回位置。",
        "Set start and end states, define role-based swimlanes, and assign each action a unique ID, input, owner, output, and next node. Specify mutually exclusive or explicitly covered decision outcomes, including rejection, timeout, withdrawal, escalation, and subprocess return points.",
      ],
      design: [
        "输出可编辑的流程说明与节点连接表，包含编号、泳道、节点类型、动作、条件、下一节点和证据记录；附人工绘制所需的方向、图例和分页规则。不要将文字表格冒称可编辑的原生Visio文件，也不要承诺已经创建线上图。",
        "Deliver an editable narrative and node-connector table with IDs, swimlanes, node types, actions, conditions, successors, and records, plus direction, legend, and pagination rules. Do not represent the table as a native Visio file or an already created online diagram.",
      ],
      checks: [
        "检查每个节点有责任人和合法连接，判断分支有明确出口、异常可闭环、跨泳道交接有输入输出，且不存在无来路或无去处的节点。请流程负责人对照真实案例走查，记录未获验证的权限与执行条件，不把规格等同实际流程已运行。",
        "Check ownership and valid connectors for every node, complete decision exits, closed exception paths, handoff inputs and outputs, and orphan nodes. Walk real cases with the process owner, recording unverified authority or execution conditions without claiming the workflow has run.",
      ],
    },
    scenarios: [
      [
        ["差旅报销流程规格", "Travel expense process specification"],
        [
          "描述申请、凭证审核、例外审批与付款节点",
          "Specify application, receipt review, exception approval, and payment nodes",
        ],
        [
          "出差政策、费用单、票据与审批权限",
          "Travel policy, expense form, receipts, and approval authority",
        ],
        ["提供报销泳道与超标分支节点表", "Provide reimbursement swimlanes and over-limit branches"],
        [
          "退单重提及付款失败必须有明确去向",
          "Give returned submissions and failed payments explicit paths",
        ],
      ],
      [
        ["采购审批泳道规格", "Purchase approval swimlane specification"],
        [
          "按需求申请、比价、审批和下单划分职责",
          "Divide requisition, comparison, approval, and ordering by role",
        ],
        [
          "采购金额门槛、询价规则、授权矩阵及订单字段",
          "Purchase thresholds, quotation rules, authorization matrix, and order fields",
        ],
        [
          "交付分金额条件及代理审批的流程表",
          "Deliver threshold conditions and delegated-approval flow",
        ],
        [
          "紧急采购与利益冲突例外需明确升级",
          "Escalate emergency purchasing and conflicts of interest",
        ],
      ],
      [
        ["客服工单处理流程", "Service ticket handling process"],
        [
          "规划受理、分类、派单、解决和回访节点",
          "Specify intake, classification, assignment, resolution, and follow-up",
        ],
        [
          "工单字段、服务等级、分类表及升级时限",
          "Ticket fields, service levels, classifications, and escalation times",
        ],
        [
          "输出含超时分支和状态定义的节点表",
          "Output nodes with timeout branches and status definitions",
        ],
        [
          "未获客户确认的解决状态不得默认关闭",
          "Do not assume closure without required customer confirmation",
        ],
      ],
      [
        ["人员入职审批流程", "Employee onboarding approval process"],
        [
          "衔接录用确认、入职资料、账号申请和首日交接",
          "Connect offer acceptance, onboarding documents, access requests, and day-one handover",
        ],
        [
          "录用审批、岗位、入职时间及权限申请规则",
          "Hiring approval, role, start date, and access request rules",
        ],
        ["绘制人事、经理和支持部门的泳道规格", "Specify HR, manager, and support swimlanes"],
        [
          "候选人敏感资料限制访问，未审批权限不视为开通",
          "Restrict candidate data and do not assume pending access is granted",
        ],
      ],
      [
        ["合同会签流程规格", "Contract review routing process"],
        [
          "按条款风险和授权层级串并联会签",
          "Route reviews sequentially or in parallel by clause risk and authority",
        ],
        [
          "合同类型、金额、版本和法务财务审批矩阵",
          "Contract type, amount, version, and legal-finance authority matrix",
        ],
        [
          "列会签节点、退回条件和重新发起路径",
          "List review nodes, return conditions, and re-routing paths",
        ],
        [
          "合同版本变化后应复核已完成审批是否仍有效",
          "Recheck whether prior approvals remain valid after version changes",
        ],
      ],
      [
        ["发票核验流程规格", "Invoice verification process"],
        [
          "区分发票收集、身份校验、金额匹配与异常处理",
          "Separate invoice collection, identity checks, matching, and exception handling",
        ],
        [
          "发票编号、订单、验收金额和审核规则",
          "Invoice identifiers, orders, accepted amounts, and review rules",
        ],
        [
          "形成票据节点、重复检测和退回路径",
          "Provide invoice nodes, duplicate checks, and return paths",
        ],
        [
          "校验失败或系统不可用时转人工复核",
          "Route failed checks or system outages to manual review",
        ],
      ],
      [
        ["客户投诉升级路径", "Customer complaint escalation path"],
        [
          "按影响和处理时限选择受理或升级分支",
          "Choose intake or escalation by impact and response deadline",
        ],
        [
          "投诉等级、服务条款、联络人及处理记录",
          "Complaint severity, service terms, contacts, and handling history",
        ],
        [
          "输出分级判断、通知及关闭确认路径",
          "Output severity decisions, notifications, and closure confirmation",
        ],
        ["赔付和公开回复需经授权批准", "Compensation and public responses require authorization"],
      ],
      [
        ["系统权限申请流程", "System access request process"],
        [
          "明确申请、业务审批、权限执行与定期复核",
          "Define request, business approval, provisioning, and periodic review",
        ],
        [
          "岗位、权限级别、审批人和失效条件",
          "Role, access levels, approvers, and expiry conditions",
        ],
        ["交付最小权限判断与撤权节点", "Deliver least-privilege decisions and revocation nodes"],
        ["审批通过不证明系统已实际授权", "Approval does not prove access was actually provisioned"],
      ],
      [
        ["仓库入库流程规格", "Warehouse receiving process"],
        [
          "按到货、数量核验、质检和上架组织节点",
          "Organize receiving, quantity checks, quality inspection, and put-away",
        ],
        [
          "采购订单、送货单、批次、数量与检验规则",
          "Purchase orders, delivery notes, lots, quantities, and inspection rules",
        ],
        [
          "编制差异收货和不合格隔离路径",
          "Specify discrepancy receiving and failed-inspection quarantine",
        ],
        [
          "数量不符或批次缺失不得直接入可用库存",
          "Do not release mismatched quantities or unknown lots into available stock",
        ],
      ],
      [
        ["数据异常处理流程", "Data exception handling process"],
        [
          "从异常识别到责任确认、修正与复核建立闭环",
          "Close the loop from anomaly detection to ownership, correction, and review",
        ],
        [
          "字段规则、异常记录、数据源及修改权限",
          "Field rules, exception records, sources, and edit permissions",
        ],
        [
          "输出异常分类、审批和复算验证节点",
          "Provide classification, approval, and recalculation-verification nodes",
        ],
        [
          "保留原始记录及修正历史，禁止掩盖缺失数据",
          "Preserve source records and correction history without hiding missing data",
        ],
      ],
      [
        ["跨部门交付流程", "Cross-team delivery process"],
        [
          "明确各团队输入、交付标准和交接确认",
          "Define each team's inputs, acceptance criteria, and handoff confirmation",
        ],
        [
          "职责矩阵、交付物、验收条件和依赖期限",
          "Responsibility matrix, deliverables, acceptance criteria, and dependency dates",
        ],
        [
          "形成泳道交接表及退回修订分支",
          "Create swimlane handoffs and return-for-revision branches",
        ],
        [
          "等待方未接收时不能默认为已验收",
          "Do not assume acceptance when the receiving team has not responded",
        ],
      ],
      [
        ["业务连续性决策树", "Business continuity decision tree"],
        [
          "按中断影响和恢复条件选择应急路径",
          "Select response paths based on outage impact and recovery criteria",
        ],
        [
          "关键服务、恢复目标、授权人及应急资源",
          "Critical services, recovery targets, decision owners, and contingency resources",
        ],
        [
          "交付决策树节点、升级条件与恢复检查",
          "Deliver decision nodes, escalation conditions, and recovery checks",
        ],
        [
          "演练方案不能宣称应急资源已实际可用",
          "A plan does not prove contingency resources are operational",
        ],
      ],
    ],
  }),
  defineFamily({
    id: "project-schedule",
    name: ["项目进度计划", "Project scheduling"],
    category: "planning",
    format: "XLSX",
    summary: [
      "以可编辑表格规划任务、依赖、资源和进度风险",
      "Plan tasks, dependencies, resources, and schedule risks in an editable workbook",
    ],
    style: [
      "日期、状态与依赖可核对；不冒称原生项目管理文件",
      "Keep dates, status, and dependencies auditable without claiming a native project file",
    ],
    sections: [
      ["计划基线", "Schedule baseline"],
      ["任务分解", "Work breakdown"],
      ["依赖和里程碑", "Dependencies and milestones"],
      ["资源与日历", "Resources and calendars"],
      ["进度和偏差", "Progress and variance"],
      ["风险与复核", "Risks and review"],
    ],
    audience: [
      "项目经理、任务负责人及进度审核人",
      "Project managers, task owners, and schedule reviewers",
    ],
    playbook: {
      inputs: [
        "收集范围、交付物、工作分解、里程碑、任务负责人、估计工期、依赖关系、工作日历和可用资源，并写明计划基线、进度截止日与数据来源。实际完成和估算完成分开记录，缺少的审批日期或工作量不得自行填造。",
        "Gather scope, deliverables, work breakdown, milestones, owners, duration estimates, dependencies, calendars, and resource availability; record the baseline, status date, and sources. Separate actual completion from forecasts and do not invent approval dates or effort.",
      ],
      method: [
        "为任务赋唯一编号，列前后置关系、提前或滞后约束及承担角色，按工作日历核算日期并辨识关键依赖和资源冲突。比较基线、实际和最新预测，记录变更原因、负责人及审批；未提供完整依赖时不要宣称已准确计算关键路径。",
        "Assign unique task IDs and predecessors, leads or lags, and owners; calculate dates against the work calendar and identify critical dependencies and resource conflicts. Compare baseline, actual, and forecast with approved change records; do not claim a precise critical path when dependencies are incomplete.",
      ],
      design: [
        "分设任务、里程碑、资源日历、假设和风险工作表，输入与公式明确区分，编号保持文本，日期和工期保留数值类型。跨时区任务另设时区字段并复核夏令时。冻结表头、支持筛选，说明状态日期及计量单位；交付普通可编辑XLSX而非原生Project项目文件。",
        "Separate task, milestone, resource calendar, assumption, and risk sheets; distinguish inputs from formulas, preserve identifiers as text, and use typed dates and durations. Use a separate time-zone field and check daylight-saving changes. Freeze and filter headers, state status date and units, and deliver ordinary editable XLSX rather than a native Project file.",
      ],
      checks: [
        "检查任务编号唯一、依赖无循环、结束不早于开始、里程碑和基线一致，并抽查工作日、假日和资源超配。独立校核关键日期及公式，只有允许的工具实际重算后才声称结果已计算；无法验证的排程假设和人工调整须明确列出。",
        "Check unique task IDs, acyclic dependencies, date ordering, milestones, baseline consistency, calendars, holidays, and resource over-allocation. Independently check critical dates and formulas, claim recalculation only when performed, and disclose unverified scheduling assumptions or manual adjustments.",
      ],
    },
    scenarios: [
      [
        ["项目里程碑依赖计划", "Milestone dependency schedule"],
        [
          "将阶段交付和审批依赖连接成可追溯里程碑",
          "Link phase deliverables and approvals into traceable milestones",
        ],
        [
          "项目阶段、里程碑日期、前置任务及审批人",
          "Phases, milestone dates, predecessors, and approvers",
        ],
        [
          "输出里程碑表、依赖清单和关键决策日期",
          "Output milestone table, dependency list, and decision dates",
        ],
        ["未确认前置任务不得视为已完成", "Do not mark unconfirmed predecessors complete"],
      ],
      [
        ["产品上线倒排计划", "Product launch backward schedule"],
        [
          "从上线窗口倒排测试、培训和发布准备",
          "Work backward from launch through testing, training, and release preparation",
        ],
        [
          "上线目标日、验收条件、任务工期与依赖",
          "Launch target, acceptance conditions, task durations, and dependencies",
        ],
        ["形成倒排表、停止条件和责任人", "Produce a backward schedule, stop criteria, and owners"],
        [
          "缺陷未关闭时上线日期应标记有条件",
          "Mark launch conditional when blocking defects remain open",
        ],
      ],
      [
        ["培训项目排期", "Training program schedule"],
        [
          "协调课程设计、讲师确认、报名及实施日期",
          "Coordinate course design, instructor confirmation, enrollment, and delivery",
        ],
        [
          "课程清单、讲师时间、场地容量及学员批次",
          "Courses, instructor availability, venue capacity, and learner cohorts",
        ],
        ["交付课程日历和资源冲突清单", "Deliver a course calendar and resource-conflict list"],
        [
          "未确认讲师或场地不能标记为已预订",
          "Do not mark unconfirmed instructors or venues as booked",
        ],
      ],
      [
        ["活动筹备进度表", "Event preparation schedule"],
        ["安排活动场地、嘉宾、物料和现场彩排", "Schedule venue, guests, materials, and rehearsal"],
        [
          "活动日期、供应商交期、审批和场地安排",
          "Event date, supplier lead times, approvals, and venue arrangements",
        ],
        ["输出倒排节点、负责人和替代方案", "Output backward milestones, owners, and contingencies"],
        ["运输延误及嘉宾变更需要单独预留缓冲", "Account for transport delays and guest changes"],
      ],
      [
        ["招聘面试排程", "Recruitment interview schedule"],
        [
          "协调岗位轮次、面试官和候选人时段",
          "Coordinate role stages, interviewers, and candidate time slots",
        ],
        [
          "岗位、面试轮次、面试官日历及候选人可用时间",
          "Roles, stages, interviewer calendars, and candidate availability",
        ],
        ["生成按日期排序的排程和待确认项", "Generate a dated schedule and pending confirmations"],
        [
          "限制候选人隐私访问，未确认时段不视为预订",
          "Restrict candidate data and do not present unconfirmed slots as booked",
        ],
      ],
      [
        ["系统迁移窗口计划", "System migration window plan"],
        [
          "拆分冻结、备份、迁移验证及回退窗口",
          "Break down freeze, backup, migration verification, and rollback windows",
        ],
        [
          "系统清单、停机许可、迁移依赖与恢复时限",
          "System inventory, downtime approval, migration dependencies, and recovery limits",
        ],
        [
          "形成分时执行计划和回退决策点",
          "Create a timed execution schedule and rollback decision points",
        ],
        ["迁移时限估算不能替代演练结果", "Estimates do not substitute for rehearsal evidence"],
      ],
      [
        ["建设项目周计划", "Construction project weekly schedule"],
        [
          "将现场作业、验收和材料到货按周衔接",
          "Connect site work, inspections, and material deliveries by week",
        ],
        [
          "工程分项、工序依赖、材料交期和施工日历",
          "Work packages, sequence dependencies, material lead times, and site calendar",
        ],
        ["交付周计划和现场阻塞跟踪表", "Deliver a weekly plan and site-blocker register"],
        [
          "天气、安全许可和现场条件变化需人工复核",
          "Manually review weather, safety permits, and site changes",
        ],
      ],
      [
        ["跨团队资源冲突", "Cross-team resource conflict"],
        [
          "比较共享人员在并行任务中的负荷和优先级",
          "Compare shared staff load and priority across concurrent tasks",
        ],
        [
          "人员可用工时、任务分配、期限和优先级",
          "Staff availability, task assignments, deadlines, and priorities",
        ],
        [
          "输出超配时段、调整备选及决策人",
          "Output over-allocation periods, alternatives, and decision owners",
        ],
        [
          "不未经确认改变人员承诺或工作日历",
          "Do not change staff commitments or calendars without confirmation",
        ],
      ],
      [
        ["项目延期恢复计划", "Schedule recovery plan"],
        [
          "比较延期原因、可压缩任务和恢复选项",
          "Compare delay causes, compressible tasks, and recovery options",
        ],
        [
          "原基线、实际进度、剩余工期及资源约束",
          "Baseline, actual progress, remaining duration, and resource constraints",
        ],
        [
          "交付新旧日期对照、措施和批准节点",
          "Deliver old-versus-new dates, actions, and approval points",
        ],
        [
          "赶工成本和质量风险需同进度一起呈现",
          "Show acceleration costs and quality risks alongside dates",
        ],
      ],
      [
        ["供应商交付排期", "Supplier delivery schedule"],
        [
          "对照订单、生产周期和验收节点跟踪交期",
          "Track delivery dates against orders, production lead time, and acceptance",
        ],
        [
          "供应商承诺日期、订单数量、运输与验收安排",
          "Supplier commitments, order quantities, shipping, and acceptance plans",
        ],
        [
          "输出交付批次、依赖和逾期升级",
          "Output delivery batches, dependencies, and overdue escalation",
        ],
        [
          "供应商口头预测不能当作已交付证据",
          "A supplier's verbal forecast is not proof of delivery",
        ],
      ],
      [
        ["季度目标里程碑", "Quarterly objective milestones"],
        [
          "将季度目标转化为可验收的阶段成果",
          "Translate quarterly objectives into measurable milestone outcomes",
        ],
        [
          "目标、衡量标准、负责人及季度日历",
          "Objectives, success measures, owners, and quarter calendar",
        ],
        [
          "提供目标到里程碑映射及进度复审点",
          "Provide objective-to-milestone mappings and review points",
        ],
        [
          "避免将活动完成率直接等同目标达成",
          "Do not equate activity completion with outcome achievement",
        ],
      ],
      [
        ["需求变更进度影响", "Change-request schedule impact"],
        [
          "分析变更对依赖任务、里程碑和资源的影响",
          "Analyze change effects on dependent tasks, milestones, and resources",
        ],
        [
          "变更申请、原计划、工期估算和审批状态",
          "Change request, baseline, duration estimates, and approval status",
        ],
        [
          "交付影响对比及待批准的调整方案",
          "Deliver an impact comparison and proposed adjustments for approval",
        ],
        [
          "未经批准的变更保留为情景而非新基线",
          "Keep unapproved changes as scenarios, not a new baseline",
        ],
      ],
    ],
  }),
  defineFamily({
    id: "contract-review",
    name: ["合同条款审阅", "Contract clause review"],
    category: "document",
    format: "DOCX",
    summary: [
      "基于合同原文整理条款问题、商业影响和人工审阅建议",
      "Review contract wording, business impact, and issues requiring human counsel",
    ],
    style: [
      "引用原条款与版本，区分事实、建议和法律判断",
      "Cite source clauses and versions; distinguish facts, suggestions, and legal conclusions",
    ],
    sections: [
      ["合同与版本", "Contract and version"],
      ["范围及义务", "Scope and obligations"],
      ["条款问题", "Clause issues"],
      ["商业影响", "Business impact"],
      ["建议及备选", "Suggestions and options"],
      ["审批与待确认", "Approvals and open questions"],
    ],
    audience: [
      "合同经办人、采购或销售负责人及法务审阅人",
      "Contract owners, procurement or sales leads, and legal reviewers",
    ],
    playbook: {
      inputs: [
        "收集完整合同、附件、修订版本、主体名称、交易背景、适用地区、审批规则和经授权的谈判记录。按条款号与页面保留原文位置，核对版本之间的遗漏；缺少附件或适用法律信息时登记缺口，不补造文本和签署状态。",
        "Collect the complete agreement and schedules, revisions, parties, transaction context, jurisdiction, approval rules, and authorized negotiation records. Preserve clause and page references, check version omissions, and flag missing schedules or governing-law information without inventing text or execution status.",
      ],
      method: [
        "逐项摘录原条款，说明义务主体、触发条件、期限、费用和例外，识别缺失或歧义及其商业后果，再提出可讨论的修改方向和备选问题。依企业政策标记审阅优先级，法律适用性和最终措辞由具备资格的法务人员确认。",
        "Extract each clause with responsible party, trigger, deadline, cost, and exceptions; identify gaps, ambiguity, and business consequences, then propose negotiable changes and questions. Apply company review priorities and refer legal applicability and final wording to qualified counsel.",
      ],
      design: [
        "以可编辑文档建立合同概览、逐条问题表、原文引用、风险说明、建议方向、责任人和确认状态，版本及页码随每项保留。不要将文本比较伪装成原生修订痕迹或批注；对无法读取的扫描附件说明限制并保留原件。",
        "Create an editable overview and clause issue table containing quotations, risks, proposed directions, owners, and status, with version and page references. Do not disguise plain-text comparisons as native tracked changes or comments; disclose unreadable scans and preserve originals.",
      ],
      checks: [
        "核对主体、合同版本、引用条款及期限一致性，检查建议是否改变未授权的商业条件，验证交叉引用及所有待审附件。敏感合同只按授权范围处理并由用户安排安全存放；说明意见不是法律结论，未经审阅不能声称合同已批准或签署。",
        "Check parties, version, clause references, dates, cross-references, and missing schedules, ensuring suggestions do not silently alter unauthorized commercial terms. Handle sensitive contracts only within authorized scope and use user-managed secure storage; review is not legal advice or proof of approval or signature.",
      ],
    },
    scenarios: [
      [
        ["付款条款审阅", "Payment terms review"],
        [
          "检查付款触发条件、账期、税费及逾期后果",
          "Review payment triggers, terms, taxes, and overdue consequences",
        ],
        [
          "合同价款、发票要求、付款节点及验收条款",
          "Price, invoice requirements, payment milestones, and acceptance terms",
        ],
        [
          "输出条款引用、金额条件和待谈判问题",
          "Output clause references, monetary conditions, and negotiation questions",
        ],
        [
          "避免将未核实税率或付款义务当成定论",
          "Do not assert unverified tax rates or payment obligations",
        ],
      ],
      [
        ["自动续约条款审阅", "Automatic renewal clause review"],
        [
          "核查续约周期、通知窗口及价格变化规则",
          "Check renewal periods, notice windows, and price changes",
        ],
        [
          "合同期限、续约原文、通知方式及历史变更",
          "Term, renewal text, notice method, and amendments",
        ],
        ["形成日期节点表与需要法务确认的问题", "Produce a date table and questions for counsel"],
        [
          "适用法律与工作日计算方法不明时不得断定通知失效",
          "Do not determine notice validity without applicable law and calendar rules",
        ],
      ],
      [
        ["责任上限审阅", "Liability cap review"],
        [
          "比较责任上限、损失类别和不受限例外",
          "Compare liability caps, loss categories, and uncapped exceptions",
        ],
        [
          "责任条款、合同金额、保险与赔偿约定",
          "Liability clauses, contract value, insurance, and indemnity",
        ],
        [
          "列出责任分配差异和待确认情景",
          "List allocation differences and scenarios requiring confirmation",
        ],
        [
          "不可自行认定条款在特定司法辖区必然有效",
          "Do not assume enforceability in a specific jurisdiction",
        ],
      ],
      [
        ["保密条款审阅", "Confidentiality clause review"],
        [
          "核查保密信息范围、接收义务和存续期限",
          "Check protected information, recipient duties, and survival period",
        ],
        [
          "保密定义、例外、披露授权及期限",
          "Confidentiality definitions, exceptions, disclosure authority, and duration",
        ],
        [
          "交付义务对照表和需补充的商业问题",
          "Deliver an obligation comparison and commercial questions",
        ],
        ["不复制超出审阅需要的秘密内容", "Do not reproduce more confidential content than needed"],
      ],
      [
        ["数据处理条款审阅", "Data processing clause review"],
        [
          "识别处理目的、数据类别、跨境与分包义务",
          "Identify processing purposes, data categories, transfers, and subprocessors",
        ],
        [
          "数据附件、处理方角色、保留期限及安全要求",
          "Data schedules, controller-processor roles, retention, and security requirements",
        ],
        [
          "列处理活动、缺口和需专业确认的事项",
          "List processing activities, gaps, and issues for specialist confirmation",
        ],
        [
          "不能将一般清单等同隐私合规认证",
          "A general checklist is not a privacy compliance certification",
        ],
      ],
      [
        ["交付验收与变更审阅", "Delivery acceptance and change review"],
        [
          "核查交付范围、验收标准、异议期与变更程序",
          "Review delivery scope, acceptance criteria, objection periods, and change control",
        ],
        [
          "工作说明书、里程碑、验收标准和变更条款",
          "Statement of work, milestones, acceptance criteria, and change clauses",
        ],
        [
          "输出交付义务和变更审批对照",
          "Produce a comparison of delivery obligations and change approvals",
        ],
        [
          "不把沉默验收解释为所有争议均已解决",
          "Do not assume deemed acceptance resolves every dispute",
        ],
      ],
      [
        ["知识产权归属审阅", "Intellectual property allocation review"],
        [
          "区分既有成果、新成果、许可范围和使用限制",
          "Separate background IP, new work, license scope, and restrictions",
        ],
        [
          "成果清单、知识产权条款、第三方许可",
          "Deliverable list, IP clauses, and third-party licenses",
        ],
        [
          "制作权属与许可对照表及待定问题",
          "Produce an ownership and license comparison with open questions",
        ],
        [
          "未确认第三方权利时不得保证可自由转授权",
          "Do not promise sublicensing rights without confirming third-party rights",
        ],
      ],
      [
        ["违约与解除条款审阅", "Breach and termination review"],
        [
          "比较违约触发、补救期、通知及终止后义务",
          "Compare breach triggers, cure periods, notice, and post-termination obligations",
        ],
        [
          "违约条款、解除条件、通知要求与费用约定",
          "Breach clauses, termination triggers, notice, and fee terms",
        ],
        ["形成触发条件与责任清单", "Create a trigger and responsibility matrix"],
        [
          "是否可以解除须由法务结合事实与法律判断",
          "Counsel must determine termination rights from facts and law",
        ],
      ],
      [
        ["争议解决条款审阅", "Dispute resolution review"],
        [
          "检查适用法律、管辖地点、仲裁与送达方式",
          "Check governing law, forum, arbitration, and service requirements",
        ],
        [
          "争议条款、主体所在地和双语版本",
          "Dispute clause, party locations, and bilingual versions",
        ],
        [
          "列冲突条款及需要确认的管辖问题",
          "List conflicting provisions and questions about jurisdiction",
        ],
        ["不推定任何争议结果或执法结论", "Do not predict dispute outcomes or enforcement"],
      ],
      [
        ["分包责任条款审阅", "Subcontracting clause review"],
        [
          "核查分包批准、职责传递及违规责任",
          "Review subcontractor approval, flowed-down duties, and liability",
        ],
        [
          "分包限制、供应商名单、保密和数据条款",
          "Subcontracting limits, supplier list, confidentiality, and data terms",
        ],
        [
          "输出分包权限及应传递义务清单",
          "Output subcontracting authority and flowed-down obligations",
        ],
        [
          "未经审查的分包商不能写成已获批准",
          "Do not represent an unreviewed subcontractor as approved",
        ],
      ],
      [
        ["服务等级与赔付审阅", "Service level and credit review"],
        [
          "核对服务指标、计算窗口、排除项及赔付上限",
          "Check service metrics, measurement windows, exclusions, and credit caps",
        ],
        [
          "服务等级附件、维护窗口、事件定义和补偿条款",
          "Service level schedule, maintenance windows, incident definitions, and credits",
        ],
        ["形成指标口径与申诉时限对照", "Produce metric definitions and claim-deadline comparison"],
        [
          "缺少实际监控数据不能认定违约或赔付额",
          "Do not determine breach or credit without monitoring evidence",
        ],
      ],
      [
        ["合同版本差异审阅", "Contract version comparison"],
        [
          "比较条款新增、删除及商业影响",
          "Compare added and deleted provisions and business impact",
        ],
        [
          "两个明确版本、附件和对应条款编号",
          "Two identified versions, schedules, and clause references",
        ],
        [
          "提交差异表和需人工复核的高风险变更",
          "Submit a difference table and material changes for review",
        ],
        [
          "文本差异表不是Word原生修订痕迹",
          "A textual comparison is not native Word tracked changes",
        ],
      ],
    ],
  }),
  defineFamily({
    id: "meeting-minutes",
    name: ["会议纪要与行动追踪", "Meeting minutes and actions"],
    category: "document",
    format: "DOCX",
    summary: [
      "将会议事实、正式决定和责任行动整理为可核验纪要",
      "Turn meeting facts, decisions, and ownership into verifiable minutes",
    ],
    style: [
      "忠于来源、区分决定与讨论，行动项可追踪",
      "Stay faithful to sources, separate decisions from discussion, and make actions traceable",
    ],
    sections: [
      ["会议信息", "Meeting details"],
      ["议题与背景", "Topics and context"],
      ["讨论要点", "Discussion points"],
      ["决定与异议", "Decisions and objections"],
      ["行动与期限", "Actions and deadlines"],
      ["待确认事项", "Open confirmations"],
    ],
    audience: ["会议主持人、参会人及行动负责人", "Meeting chairs, participants, and action owners"],
    playbook: {
      inputs: [
        "收集会议名称、日期时区、参会及缺席人员、议程、授权记录、可用笔记和相关文件，记录每项材料来源与版本。录音转写若未经确认应标记不确定，缺少发言人或数字不能据上下文猜测，更不能伪造投票和决定。",
        "Gather meeting name, date and time zone, attendance and absences, agenda, authority records, notes, and related files with sources and versions. Mark unverified transcription uncertainty; do not infer missing speakers or figures or invent votes or decisions.",
      ],
      method: [
        "按议题整理事实、不同观点、正式决定、异议及待定问题，只有来源明确时才归属发言人。将每项行动拆成动词、责任人、交付物、截止时间和依赖，缺少任一要素标记待确认；会后先交主持人核对再分发。",
        "Organize each topic into facts, differing views, decisions, objections, and open questions, attributing speakers only when supported. Record each action with verb, owner, deliverable, deadline, and dependency, flagging gaps; have the chair verify before distribution.",
      ],
      design: [
        "文档首部列会议元信息和决议摘要，正文按议题分节，行动表设置编号、事项、负责人、到期日、状态和来源字段。保留必要的不同意见，涉及保密讨论或人事信息单独标记访问范围；使用可编辑标题和表格便于后续追踪。",
        "Place meeting metadata and decision summary first, organize the body by topic, and use an action table with ID, task, owner, deadline, status, and source. Preserve material dissent and label confidential or personnel discussion for appropriate access; use editable headings and tables.",
      ],
      checks: [
        "对照笔记确认会议时间、参会名单、数字、决议权限和责任期限，检查重复行动及互相冲突的记录。主持人未确认之处标记草稿；只提供纪要和跟进材料，不声称已经通知参与人、创建任务或获得全部参会人同意。",
        "Verify time, attendees, figures, authority, and action deadlines against the notes; check duplicate actions and conflicting records. Label chair-unconfirmed content as draft, and do not claim participants were notified, tasks created, or universal consent obtained.",
      ],
    },
    scenarios: [
      [
        ["管理层待决事项纪要", "Leadership decisions and open items"],
        [
          "区分已授权决策、待决事项和不同意见",
          "Separate authorized decisions, open items, and dissent",
        ],
        [
          "会议议程、权限范围、讨论记录及决定依据",
          "Agenda, authority scope, discussion notes, and decision evidence",
        ],
        ["输出决策编号、责任人和复审日期", "Output decision IDs, owners, and review dates"],
        [
          "无正式授权或表决证据不得编造决议",
          "Do not invent resolutions without authority or voting evidence",
        ],
      ],
      [
        ["周例会行动纪要", "Weekly meeting action minutes"],
        [
          "汇总本周进度、阻塞和下周责任行动",
          "Summarize weekly progress, blockers, and next actions",
        ],
        [
          "上期行动表、本次更新、责任人与截止时间",
          "Previous action list, current updates, owners, and deadlines",
        ],
        ["提交状态变化及逾期事项清单", "Submit status changes and overdue items"],
        ["未汇报事项不默认完成", "Do not assume unreported actions are complete"],
      ],
      [
        ["项目启动会纪要", "Project kickoff minutes"],
        [
          "记录范围、目标、里程碑及跨团队承诺",
          "Record scope, objectives, milestones, and cross-team commitments",
        ],
        [
          "项目章程、启动议程、参会记录和依赖",
          "Charter, kickoff agenda, attendance, and dependencies",
        ],
        ["生成已确认范围与待分配事项表", "Generate confirmed scope and unassigned-item tables"],
        ["未经确认的资源承诺保留待定", "Keep unconfirmed resource commitments pending"],
      ],
      [
        ["客户需求会议纪要", "Customer requirements meeting minutes"],
        [
          "区分客户原话、需求假设及双方确认范围",
          "Separate customer statements, assumptions, and agreed scope",
        ],
        [
          "客户授权、议题、需求记录和交付约束",
          "Customer authorization, topics, requirements notes, and constraints",
        ],
        [
          "输出需求清单、证据和确认问题",
          "Output requirements, evidence, and confirmation questions",
        ],
        [
          "不将讨论中提出的功能默认纳入合同",
          "Do not add discussed features to contractual scope by assumption",
        ],
      ],
      [
        ["故障复盘会议纪要", "Incident retrospective minutes"],
        [
          "按时间线记录影响、处置、证据与改进行动",
          "Record impact, response, evidence, and improvements along a timeline",
        ],
        [
          "事件记录、监控证据、会议笔记与响应时间",
          "Incident records, monitoring evidence, notes, and response times",
        ],
        [
          "输出事件时间线、待证实根因及整改表",
          "Output the timeline, unverified root causes, and remediation table",
        ],
        [
          "未经分析验证不得将相关性断言为根因",
          "Do not assert correlation as root cause without analysis",
        ],
      ],
      [
        ["供应商评审会议纪要", "Supplier review minutes"],
        [
          "记录交付表现、证据、问题和纠正措施",
          "Record delivery performance, evidence, issues, and corrective actions",
        ],
        [
          "合同指标、交付数据、会议反馈及问题清单",
          "Contract metrics, delivery data, meeting feedback, and issue list",
        ],
        ["生成指标对照和双方责任行动", "Generate metric comparisons and actions for both parties"],
        [
          "争议数据标明来源，未经确认不宣布违约",
          "Attribute disputed data and do not declare breach without confirmation",
        ],
      ],
      [
        ["预算评审行动纪要", "Budget review action minutes"],
        [
          "整理预算版本、差异原因和需批准事项",
          "Organize budget version, variance reasons, and approvals required",
        ],
        [
          "预算草案、实际数据、部门意见和决策记录",
          "Draft budget, actual data, department views, and decisions",
        ],
        [
          "交付预算差异、决定及补充资料责任表",
          "Deliver budget variances, decisions, and evidence owners",
        ],
        [
          "未经批准的调整不能写成正式预算",
          "Do not represent unapproved adjustments as the final budget",
        ],
      ],
      [
        ["远程会议纪要", "Remote meeting minutes"],
        [
          "保留时区、参会状态、会议决定及后续行动",
          "Retain time zones, attendance, decisions, and next actions",
        ],
        [
          "会议邀请、参会记录、笔记及共享材料",
          "Invitation, attendance record, notes, and shared materials",
        ],
        ["输出可供异步确认的纪要与行动表", "Output asynchronous-review minutes and action list"],
        [
          "掉线发言缺失需确认，不推定参会人赞同",
          "Verify missing discussion due to disconnection; do not infer agreement",
        ],
      ],
      [
        ["跨部门争议协调纪要", "Cross-team dispute meeting minutes"],
        [
          "并列记录争议事实、各方诉求和解决路径",
          "Record contested facts, each party's position, and the resolution path",
        ],
        [
          "议题、双方证据、权限和已讨论选项",
          "Issues, both parties' evidence, authority, and options discussed",
        ],
        [
          "形成分歧清单、临时安排及决策期限",
          "Create a disagreement list, interim actions, and decision deadline",
        ],
        ["不得把调解建议写成各方已同意", "Do not describe a mediation proposal as agreed"],
      ],
      [
        ["审核整改会议纪要", "Audit remediation meeting minutes"],
        [
          "逐项关联发现、整改责任人和验证证据",
          "Link each finding to an owner and verification evidence",
        ],
        [
          "审核发现编号、整改计划、期限和证据状态",
          "Finding IDs, remediation plan, deadlines, and evidence status",
        ],
        ["输出问题台账与下次验证日期", "Output an issue register and next verification dates"],
        ["完成行动不等于独立验证通过", "Completing an action is not independent verification"],
      ],
      [
        ["培训复盘会议纪要", "Training retrospective minutes"],
        [
          "总结学习目标、反馈证据和课程改进决定",
          "Summarize learning objectives, feedback evidence, and improvement decisions",
        ],
        [
          "课程计划、反馈结果、会议讨论及改进建议",
          "Course plan, feedback, discussion, and proposed improvements",
        ],
        ["列出已决定调整、负责人和试运行节点", "List approved changes, owners, and trial dates"],
        [
          "样本量不足时不外推培训效果",
          "Do not extrapolate training outcomes from insufficient samples",
        ],
      ],
      [
        ["产品评审决定纪要", "Product review decision minutes"],
        [
          "记录方案对比、通过条件和延后事项",
          "Record option comparisons, approval conditions, and deferred items",
        ],
        [
          "评审材料、用户证据、风险和决策记录",
          "Review material, user evidence, risks, and decisions",
        ],
        [
          "输出决定、前提条件和下次评审问题",
          "Output decisions, prerequisites, and next-review questions",
        ],
        [
          "条件通过不能写成无条件上线批准",
          "Do not equate conditional approval with unconditional launch",
        ],
      ],
    ],
  }),
  defineFamily({
    id: "business-correspondence",
    name: ["公文与商务函件", "Formal and business correspondence"],
    category: "document",
    format: "DOCX",
    summary: [
      "起草事实可核查、审批责任清晰的正式函件",
      "Draft formal correspondence with verifiable facts and clear approval responsibility",
    ],
    style: [
      "格式庄重、措辞准确，按真实身份和授权拟稿",
      "Use precise, formal wording grounded in actual identity and authority",
    ],
    sections: [
      ["函件目的", "Purpose"],
      ["收发身份", "Sender and recipient"],
      ["事实背景", "Factual context"],
      ["请求或通知", "Request or notice"],
      ["附件与期限", "Attachments and deadlines"],
      ["签发复核", "Issuance review"],
    ],
    audience: [
      "业务经办人、授权签发人及函件接收方",
      "Business owners, authorized signatories, and recipients",
    ],
    playbook: {
      inputs: [
        "收集发收双方完整名称和身份、函件目的、事实证据、合同或制度依据、约定的通知方式、附件、回复期限和签发权限。核对机构名称、文号及日期是否真实存在，缺失时使用明确待填标记，不虚构印章、签名或送达结果。",
        "Collect full sender and recipient identities, purpose, evidence, contract or policy basis, notice method, attachments, response deadline, and signing authority. Verify names, reference numbers, and dates; mark missing details rather than inventing seals, signatures, or delivery.",
      ],
      method: [
        "先判断函件属于邀请、告知、请求、确认或争议通知，依据提供的证据编写背景、明确事项、所需答复和联系方式。涉及法律后果或期限计算时注明适用合同并交法务确认；措辞按授权范围拟定，不擅自代表机构承诺。",
        "Classify the letter as an invitation, notice, request, confirmation, or dispute notice. Draft context, specific matters, requested response, and contact information from evidence; route legal effects and deadline calculations to counsel and do not make unauthorized institutional commitments.",
      ],
      design: [
        "使用可编辑文档呈现标题、收件方、正文、附件、落款和日期，必要时以紧凑表格列事项与期限；机构模板、字体和页边距优先遵循用户提供规范。内部审批意见与对外正文分开，不伪造正式文号、公章或电子签名。",
        "Use an editable document with title, recipient, body, attachments, signatory, and date, adding a compact action table when useful. Follow supplied institutional templates and page conventions; separate internal notes from external text and never invent reference numbers, seals, or signatures.",
      ],
      checks: [
        "核对双方名称、事实日期、金额、条款引用、附件和回复方式，确认责任人具有签发权限，检查正文与附件版本一致。正式公文格式或送达效力需由用户所在机构及专业人员核定；离线草稿不表示已经签署、寄送或收到回执。",
        "Check party names, dates, amounts, clause citations, attachments, and response method, and verify signatory authority and version consistency. Institutional form and legal service must be confirmed by the organization and specialists; an offline draft is not signed, sent, or acknowledged.",
      ],
    },
    scenarios: [
      [
        ["正式合作邀请函", "Formal cooperation invitation"],
        [
          "明确合作主题、拟议范围及讨论邀请",
          "State the cooperation topic, proposed scope, and discussion invitation",
        ],
        [
          "双方机构名称、合作背景、联系人和候选日期",
          "Both organizations, cooperation context, contact, and proposed dates",
        ],
        ["准备正式邀请函及待确认附件", "Prepare a formal invitation and pending-attachment list"],
        ["拟议合作不能写成已达成协议", "Do not present proposed cooperation as an agreement"],
      ],
      [
        ["交付延期说明函", "Delivery delay explanation"],
        [
          "说明延期事实、影响及拟议调整安排",
          "Explain delay facts, impact, and proposed adjustment",
        ],
        [
          "合同节点、实际进度、延期原因和批准方案",
          "Contract milestones, actual progress, delay cause, and approved plan",
        ],
        [
          "交付时间对照及需对方确认的函件",
          "Deliver a date comparison and letter requesting confirmation",
        ],
        [
          "未经证实原因和未经批准的新日期均需标注",
          "Flag unverified causes and unapproved revised dates",
        ],
      ],
      [
        ["逾期付款提醒函", "Overdue payment reminder"],
        [
          "列明到期账款及请求核对的付款安排",
          "List overdue amounts and request confirmation of payment arrangements",
        ],
        [
          "合同号、发票、到期日、未清金额和对账记录",
          "Contract, invoices, due dates, outstanding amounts, and reconciliation",
        ],
        ["拟定礼貌提醒函与单据清单", "Draft a courteous reminder and supporting-document list"],
        [
          "存在争议款或已到账未核销时先核实",
          "Verify disputed or received-but-unallocated funds first",
        ],
      ],
      [
        ["项目变更确认函", "Project change confirmation"],
        [
          "对照变更前后范围、日期与责任确认事项",
          "Compare prior and proposed scope, dates, and responsibilities",
        ],
        [
          "变更申请、原合同、影响评估和审批状态",
          "Change request, original contract, impact analysis, and approval status",
        ],
        [
          "形成逐项列示并待双方确认的函件",
          "Prepare a line-item letter for both parties' confirmation",
        ],
        [
          "未签署确认不等于合同已变更",
          "Unsigned confirmation does not establish a contract amendment",
        ],
      ],
      [
        ["会议邀请公函", "Formal meeting invitation"],
        [
          "说明会议目的、时间、地点和参会要求",
          "State the meeting purpose, time, venue, and participation requirements",
        ],
        [
          "会议主题、主办单位、日期时区和授权联系人",
          "Meeting topic, host, date and time zone, and authorized contact",
        ],
        ["输出邀请正文、议程和回复方式", "Output the invitation, agenda, and response method"],
        [
          "场地和嘉宾未确认时不得标记已落实",
          "Do not claim a venue or guest is confirmed prematurely",
        ],
      ],
      [
        ["供应商询价函", "Supplier quotation request"],
        [
          "列明采购规格、数量、交期和报价口径",
          "Specify purchase requirements, quantities, delivery, and quotation basis",
        ],
        [
          "物料规格、预计数量、交付地点和答复期限",
          "Specifications, estimated quantity, delivery place, and response deadline",
        ],
        ["形成可公平比较的询价要求", "Prepare quotation requirements suitable for fair comparison"],
        [
          "不得泄露竞争供应商的保密报价",
          "Do not disclose competing suppliers' confidential quotations",
        ],
      ],
      [
        ["商务报价回复函", "Commercial quotation reply"],
        [
          "区分正式授权报价与仍需确认的商业条件",
          "Distinguish approved pricing from conditions requiring confirmation",
        ],
        [
          "询价需求、授权价格、税费、交期与有效期",
          "Inquiry, approved pricing, taxes, lead time, and validity",
        ],
        ["输出报价函及条款待核对表", "Output a quotation letter and conditions checklist"],
        [
          "未经批准不得承诺价格、供货能力或付款条件",
          "Do not promise unapproved pricing, supply capacity, or payment terms",
        ],
      ],
      [
        ["售后致歉函", "After-sales apology letter"],
        [
          "陈述已核实问题、歉意和可执行的处理安排",
          "State verified issues, apology, and executable response",
        ],
        [
          "客户反馈、事实核实、处理权限和补救方案",
          "Customer feedback, verified facts, authority, and remedy",
        ],
        [
          "形成经审核的客户沟通函和跟进责任表",
          "Prepare reviewed customer correspondence and follow-up ownership",
        ],
        [
          "不自行承认法律责任或承诺未经批准赔偿",
          "Do not independently admit legal liability or promise unapproved compensation",
        ],
      ],
      [
        ["协议终止通知草稿", "Agreement termination notice draft"],
        [
          "对照约定的触发条件和通知方式拟定草稿",
          "Draft against contractual triggers and notice requirements",
        ],
        [
          "合同条款、事实证据、通知地址和审批意见",
          "Contract provisions, evidence, notice address, and approval",
        ],
        [
          "提供条款引用、拟定日期和法务待审问题",
          "Provide clause citations, proposed dates, and questions for counsel",
        ],
        [
          "期限与送达效力必须由法务核验",
          "Counsel must verify deadlines and legal effectiveness of service",
        ],
      ],
      [
        ["资料申请公函", "Formal information request"],
        [
          "明确资料用途、范围和安全提交方式",
          "Specify purpose, scope, and secure submission method",
        ],
        [
          "申请依据、资料清单、接收人和处理期限",
          "Request basis, material list, recipient, and deadline",
        ],
        [
          "形成逐项资料请求和联系人说明",
          "Prepare itemized information requests and contact details",
        ],
        [
          "遵守数据最小化，不索取无关敏感资料",
          "Minimize data and avoid requesting unrelated sensitive information",
        ],
      ],
      [
        ["内部事项通知", "Internal operational notice"],
        [
          "说明适用对象、执行时间和责任分工",
          "State affected audience, effective time, and responsibilities",
        ],
        [
          "批准文件、事项内容、实施时间与咨询渠道",
          "Approved policy, subject, implementation date, and contact channel",
        ],
        ["起草通知和受影响岗位行动清单", "Draft a notice and action list for affected roles"],
        ["未批准内容不得作为生效制度发布", "Do not publish unapproved content as effective policy"],
      ],
      [
        ["授权代表确认函", "Authorized representative confirmation"],
        [
          "确认代表身份、授权事项及有效期限",
          "Confirm representative identity, authority scope, and validity period",
        ],
        [
          "授权书、机构名称、代表角色和签发权限",
          "Authorization instrument, organization, representative role, and signing authority",
        ],
        [
          "拟定授权确认正文及需核验证据",
          "Draft confirmation text and evidence requiring verification",
        ],
        [
          "不得虚构签名、印章或超出授权范围的权利",
          "Do not invent signatures, seals, or powers beyond authorization",
        ],
      ],
    ],
  }),
  defineFamily({
    id: "learning-assessment",
    name: ["学习与能力测评", "Learning and capability assessment"],
    category: "learning",
    format: "DOCX",
    summary: [
      "设计题目、评分标准与结果复核，关联真实学习目标",
      "Design questions, scoring rubrics, and result review around learning objectives",
    ],
    style: [
      "目标清晰、标准可观察、题目和答案分区",
      "Use clear objectives, observable criteria, and separate questions from answers",
    ],
    sections: [
      ["测评目标", "Assessment objectives"],
      ["对象与范围", "Audience and scope"],
      ["题目与任务", "Questions and tasks"],
      ["评分标准", "Scoring rubric"],
      ["反馈与复测", "Feedback and reassessment"],
      ["公平及隐私", "Fairness and privacy"],
    ],
    audience: [
      "培训设计者、讲师、学员及测评审核人",
      "Learning designers, instructors, learners, and assessment reviewers",
    ],
    playbook: {
      inputs: [
        "收集学习目标、岗位能力、受测对象、教学内容、可用时间、评分政策、辅助需求和已有题库或案例。标注资料出处、适用版本及可使用授权，识别敏感信息和样本限制；未提供真实成绩时不制造个人或群体分数。",
        "Collect learning objectives, competencies, audience, curriculum, available time, scoring policy, accommodations, and authorized questions or cases. Record sources and versions, identify sensitive data and sample limits, and never invent individual or group scores.",
      ],
      method: [
        "将每个学习目标映射到题型、可观察行为和分值，设计覆盖基础、应用及异常情境的题目与参考答案。评分标准描述可复核表现及部分得分，安排考前试做、成绩复核和反馈；高风险人事决定由有权人员结合完整证据作出。",
        "Map each objective to a question type, observable behavior, and score; cover basic, applied, and exception scenarios with answer guidance. Define reviewable performance and partial-credit rules, pilot questions, review results, and route consequential employment decisions to authorized people with full evidence.",
      ],
      design: [
        "以可编辑文档区分学员题卷、讲师答案、评分量规及复测计划，题号与目标映射保持一致，提供足够答题空间和清晰的语言。对无障碍需求提供人工调整说明，避免以颜色单独区分正确与错误或将答案暴露在题页。",
        "Use editable sections for learner questions, instructor answers, rubrics, and reassessment, keeping IDs aligned with objectives and leaving response space. Explain manual accommodations, do not rely on color alone, and keep answers separate from learner pages.",
      ],
      checks: [
        "检查题干是否单义、标准答案是否有依据、分值总和与题目一致，抽查不同评分人的一致性及完成时间。审查歧视性表述、隐私披露和样本偏差；未实际施测时不得声称通过率、信效度或培训效果已经验证。",
        "Check unambiguous questions, supported answers, score totals, inter-rater consistency, and timing. Review discriminatory language, privacy, and sampling bias; do not claim pass rates, reliability, validity, or learning outcomes without actual assessment.",
      ],
    },
    scenarios: [
      [
        ["培训前摸底评估", "Pre-training diagnostic assessment"],
        [
          "识别学员已有知识与课程起点差异",
          "Identify prior knowledge and variation in starting level",
        ],
        [
          "课程目标、学员背景、先修要求和评估时间",
          "Course goals, learner background, prerequisites, and assessment time",
        ],
        [
          "设计诊断题、答案和分组建议",
          "Design diagnostic questions, answers, and grouping guidance",
        ],
        [
          "摸底结果不应未经说明用于淘汰",
          "Do not use diagnostic results for exclusion without disclosure",
        ],
      ],
      [
        ["岗位能力测验", "Role capability assessment"],
        [
          "围绕岗位任务检验知识和具体操作判断",
          "Assess knowledge and operational judgments against role tasks",
        ],
        [
          "岗位职责、能力标准、业务案例和评分规则",
          "Role duties, competency standards, business cases, and scoring rules",
        ],
        ["输出题目蓝图、题卷及评分量规", "Output a test blueprint, questions, and scoring rubric"],
        [
          "测评结果需结合实际工作证据复核",
          "Review assessment results alongside actual work evidence",
        ],
      ],
      [
        ["情景判断题设计", "Situational judgment question design"],
        [
          "针对工作冲突比较可选行动及其后果",
          "Compare possible actions and consequences in workplace dilemmas",
        ],
        [
          "工作情景、职责边界、政策和期望行为",
          "Work scenarios, authority boundaries, policies, and desired behavior",
        ],
        ["提供题干、选项、依据和解释", "Provide stems, options, rationale, and explanations"],
        [
          "避免多个答案无依据地判为唯一正确",
          "Do not label one answer uniquely correct without support",
        ],
      ],
      [
        ["产品知识随堂测", "Product knowledge check"],
        [
          "核查功能边界、适用客户和常见误解",
          "Assess functionality, intended customers, and common misconceptions",
        ],
        [
          "最新产品资料、已验证功能和培训目标",
          "Current product material, verified functionality, and objectives",
        ],
        ["输出短题、标准答案及出处", "Output short questions, answers, and sources"],
        ["未发布功能不得当作现有能力", "Do not present unreleased features as available"],
      ],
      [
        ["上机实操评分", "Hands-on task scoring"],
        [
          "按操作步骤、结果和异常处理设置观察标准",
          "Score observable steps, outcomes, and exception handling",
        ],
        [
          "实验环境、任务目标、操作限制和完成时间",
          "Lab environment, task goals, restrictions, and duration",
        ],
        ["制作操作任务卡及分级评分表", "Create task cards and graded observation rubrics"],
        [
          "不要在真实生产数据上安排未经授权的操作",
          "Do not require unauthorized actions against production data",
        ],
      ],
      [
        ["管理培训多来源反馈", "Management training multi-source feedback"],
        [
          "围绕可观察管理行为设计多角色反馈",
          "Design multi-role feedback around observable management behaviors",
        ],
        [
          "能力模型、反馈对象、角色范围和同意要求",
          "Competency model, participants, role scope, and consent rules",
        ],
        [
          "输出题目、汇总规则和解释指引",
          "Output questions, aggregation rules, and interpretation guidance",
        ],
        [
          "小样本需防止身份反推且不得捏造匿名保障",
          "Prevent reidentification in small groups and do not invent anonymity guarantees",
        ],
      ],
      [
        ["课后学习反馈评估", "Post-course learning feedback"],
        [
          "区分课程满意度、学习自评和实际应用",
          "Separate course satisfaction, self-assessed learning, and application",
        ],
        [
          "课程目标、学员反馈、练习和后续工作任务",
          "Objectives, participant feedback, exercises, and follow-on tasks",
        ],
        [
          "形成反馈问题和后续应用观察表",
          "Create feedback questions and an application observation sheet",
        ],
        ["满意度不能证明能力已经提升", "Satisfaction alone does not prove skill improvement"],
      ],
      [
        ["考试蓝图设计", "Assessment blueprint"],
        [
          "按目标、认知层次和难度规划题目覆盖",
          "Plan coverage by objective, cognitive level, and difficulty",
        ],
        [
          "课程大纲、学习目标、题型限制及总分",
          "Syllabus, objectives, allowed formats, and total score",
        ],
        [
          "交付目标题号映射、权重及样题",
          "Deliver objective-to-question mapping, weights, and sample items",
        ],
        [
          "各权重合计与通过标准须经审核",
          "Have reviewers verify total weights and passing criteria",
        ],
      ],
      [
        ["新员工试用期评估", "New hire probation assessment"],
        [
          "按岗位目标、辅导记录和证据评价进展",
          "Evaluate progress against role goals, coaching, and evidence",
        ],
        [
          "岗位目标、观察记录、反馈和公司考核政策",
          "Role goals, observations, feedback, and evaluation policy",
        ],
        ["交付证据表、评分量规及反馈计划", "Deliver evidence tables, rubric, and feedback plan"],
        [
          "涉及雇佣决定须由授权人员公平复核",
          "Authorized staff must fairly review employment decisions",
        ],
      ],
      [
        ["销售话术角色扮演评分", "Sales role-play evaluation"],
        [
          "观察需求澄清、回应异议与合规表述",
          "Observe discovery, objection handling, and compliant claims",
        ],
        [
          "产品资料、客户情景、角色脚本及评分维度",
          "Product information, customer scenario, role script, and scoring dimensions",
        ],
        [
          "生成角色卡、观察表和具体反馈",
          "Generate role cards, observation sheets, and actionable feedback",
        ],
        [
          "不能奖励夸大产品能力或误导客户",
          "Do not reward exaggerated capabilities or misleading customer claims",
        ],
      ],
      [
        ["知识差距分析", "Knowledge gap analysis"],
        [
          "按目标比较掌握情况及需要补充的主题",
          "Compare demonstrated proficiency and reinforcement needs by objective",
        ],
        [
          "题目映射、有效答卷、分数口径和人数",
          "Question mapping, valid responses, score definitions, and counts",
        ],
        [
          "输出缺口分组、证据和复训建议",
          "Output grouped gaps, evidence, and reinforcement suggestions",
        ],
        [
          "区分缺考与零分，样本不足不推广结论",
          "Separate absence from zero scores and avoid broad inference from small samples",
        ],
      ],
      [
        ["考核结果复审", "Assessment result review"],
        [
          "复核题目、评分一致性和成绩申诉",
          "Review questions, scoring consistency, and score appeals",
        ],
        [
          "答卷、评分记录、评分标准及申诉理由",
          "Responses, scoring records, rubrics, and appeal grounds",
        ],
        [
          "形成复审意见、差异及处理记录",
          "Produce review findings, discrepancies, and disposition records",
        ],
        [
          "未获授权不更改成绩，保留原始记录",
          "Do not change grades without authority; retain original records",
        ],
      ],
    ],
  }),
  defineFamily({
    id: "policy-rollout",
    name: ["制度宣导与执行", "Policy rollout and adoption"],
    category: "people",
    format: "DOCX",
    summary: [
      "将已批准制度转化为分对象宣导、行动及复核材料",
      "Turn approved policies into audience-specific communication, action, and review materials",
    ],
    style: [
      "适用范围和生效日期明确，实例与正式条款分开",
      "State scope and effective dates; separate examples from binding policy",
    ],
    sections: [
      ["制度依据", "Policy authority"],
      ["适用对象", "Affected audiences"],
      ["关键要求", "Key requirements"],
      ["实施安排", "Implementation"],
      ["例外与咨询", "Exceptions and support"],
      ["确认及复审", "Acknowledgment and review"],
    ],
    audience: [
      "制度负责人、部门主管及受影响员工",
      "Policy owners, department managers, and affected employees",
    ],
    playbook: {
      inputs: [
        "收集正式批准的制度文本、版本、生效日期、适用对象、岗位职责、现行流程、沟通渠道和可用培训资料。核对新旧版本及过渡安排，标出须由法务或政策拥有者解释的条款；缺少批准证明时只提供草拟材料，不宣称政策生效。",
        "Gather approved policy text, version, effective date, audience, roles, current processes, communication channels, and training materials. Check version changes and transition arrangements, flag clauses for policy-owner or legal interpretation, and label drafts when approval is missing.",
      ],
      method: [
        "按不同受众提炼必须执行的动作、禁止事项、例外审批、实施日期及咨询渠道，并用与原文一致的例子说明常见判断。制定宣导、答疑、签收或培训计划及复审责任，不把阅读或点击自动等同理解，更不擅自修改制度。",
        "Translate the policy for each audience into required actions, prohibitions, exceptions, dates, and support channels, using examples consistent with the source. Plan communications, questions, acknowledgments or training, and review ownership; do not equate a click with understanding or silently alter policy.",
      ],
      design: [
        "在可编辑文档中分别呈现制度概览、受影响角色、关键变化对照、行动清单、案例问答和负责人联系方式；正式条文与解释示例清楚分区。表格注明版本和日期，印制或屏幕阅读均保持标题层级和可读字号，不假装已经线上发布。",
        "Use an editable overview, affected-role list, changes, actions, example questions, and contacts, clearly separating official wording from explanation. Label versions and dates and maintain readable headings for print and screen; do not claim online publication.",
      ],
      checks: [
        "逐条对照已批准原文核验义务、截止日、例外和责任人，检查旧制度与过渡期间是否冲突。确认敏感内容按授权分享、引用链接实际可用，并记录尚未确认的传播范围、培训参与和效果；签收表或草稿不能证明制度已得到执行。",
        "Verify obligations, deadlines, exceptions, and owners against the approved source, including prior-policy and transition conflicts. Check authorized sharing and usable links, record unverified distribution, attendance, and effectiveness, and do not treat a draft or acknowledgment as proof of compliance.",
      ],
    },
    scenarios: [
      [
        ["报销政策上线宣导", "Expense policy rollout"],
        [
          "解释费用分类、凭证要求与超标审批变化",
          "Explain expense categories, evidence requirements, and over-limit approvals",
        ],
        [
          "已批准报销制度、职级标准、生效日及旧规则",
          "Approved expense policy, grade limits, effective date, and prior rules",
        ],
        ["交付员工说明、对照表和常见问题", "Deliver staff guidance, a comparison table, and FAQs"],
        [
          "具体报销结论需按票据和财务审批确认",
          "Individual reimbursement decisions require receipts and finance approval",
        ],
      ],
      [
        ["信息安全制度培训", "Information security policy briefing"],
        [
          "按岗位说明账号使用、可疑事件报告与审批",
          "Explain account use, incident reporting, and approvals by role",
        ],
        [
          "安全制度、事件通报路径、岗位权限和案例",
          "Security policy, incident reporting path, role permissions, and examples",
        ],
        [
          "制作培训讲义、情景题和上报清单",
          "Produce a briefing, scenario questions, and reporting checklist",
        ],
        [
          "不在培训材料中公开密码或真实敏感事件细节",
          "Do not publish passwords or unnecessary details of real incidents",
        ],
      ],
      [
        ["数据保留政策宣导", "Data retention policy briefing"],
        [
          "区分资料分类、保留期限、例外及销毁审批",
          "Distinguish data classes, retention, exceptions, and disposal approval",
        ],
        [
          "保留政策、数据分类、法务保留及责任人",
          "Retention policy, data classes, legal holds, and owners",
        ],
        [
          "形成分类对照、行动清单和咨询路径",
          "Create a category comparison, action list, and support path",
        ],
        [
          "法务保留优先且材料不触发实际删除",
          "Legal holds take precedence and the document does not delete data",
        ],
      ],
      [
        ["混合办公制度说明", "Hybrid work policy guidance"],
        [
          "说明适用岗位、预约安排和例外申请",
          "Explain eligible roles, scheduling, and exception requests",
        ],
        [
          "批准政策、工作地点规定、团队安排和日期",
          "Approved policy, location rules, team arrangements, and dates",
        ],
        ["输出员工说明及主管执行清单", "Produce employee guidance and a manager checklist"],
        [
          "个人例外应遵循隐私及人工审批规则",
          "Handle individual exceptions under privacy and human approval rules",
        ],
      ],
      [
        ["新审批流程公告", "New approval process announcement"],
        [
          "对比原流程、新授权层级和切换日期",
          "Compare prior and new approval levels and transition dates",
        ],
        [
          "审批矩阵、流程版本、切换计划和责任人",
          "Approval matrix, process versions, transition plan, and owners",
        ],
        [
          "交付公告、岗位行动和过渡期问答",
          "Deliver an announcement, role actions, and transition FAQs",
        ],
        [
          "未获授权的审批人不能由宣导材料赋权",
          "Communication material cannot authorize an unapproved approver",
        ],
      ],
      [
        ["客户投诉制度培训", "Customer complaint policy training"],
        [
          "解释受理、分级、响应时限和升级条件",
          "Explain intake, classification, response deadlines, and escalation",
        ],
        [
          "投诉制度、服务承诺、角色分工及案例",
          "Complaint policy, service commitments, roles, and examples",
        ],
        [
          "制作分级实例、处理清单及转介路径",
          "Prepare classification examples, handling checklist, and referrals",
        ],
        [
          "赔付承诺与敏感客户信息需按权限处理",
          "Handle compensation commitments and customer data under authorized processes",
        ],
      ],
      [
        ["采购权限分级说明", "Procurement authority briefing"],
        [
          "按金额和采购类型说明申请与审批角色",
          "Explain request and approval roles by amount and purchase type",
        ],
        [
          "授权矩阵、采购政策、金额门槛和币种",
          "Authority matrix, purchasing policy, thresholds, and currency",
        ],
        ["交付分级对照表及边界案例", "Deliver an approval-tier table and boundary examples"],
        [
          "不得通过拆单或示例绕过审批门槛",
          "Do not use split purchases or examples to bypass thresholds",
        ],
      ],
      [
        ["保密制度年度复训", "Annual confidentiality refresher"],
        [
          "结合常见共享和离岗情境复习保密义务",
          "Review confidentiality duties through sharing and departure scenarios",
        ],
        [
          "保密制度、信息分类、历史培训材料及版本",
          "Confidentiality policy, information classifications, prior materials, and version",
        ],
        [
          "输出复训提纲、情景问题和签收记录样式",
          "Output refresher outline, scenarios, and acknowledgment template",
        ],
        ["签收不等于保密措施已落实", "Acknowledgment does not prove controls were implemented"],
      ],
      [
        ["无障碍沟通制度宣导", "Accessible communication policy briefing"],
        [
          "按角色说明可访问文档和合理调整的请求路径",
          "Explain accessible documents and accommodation request paths by role",
        ],
        [
          "组织政策、适用范围、支持渠道及现有规范",
          "Organization policy, scope, support channels, and existing standards",
        ],
        [
          "交付实践检查表和支持联系人说明",
          "Deliver a practical checklist and support-contact guidance",
        ],
        [
          "不披露个人健康资料或承诺未核实的支持",
          "Do not disclose health information or promise unconfirmed support",
        ],
      ],
      [
        ["质量流程修订宣导", "Quality process revision rollout"],
        [
          "说明修订节点、记录要求和旧版转换时间",
          "Explain revised steps, records, and old-version transition",
        ],
        [
          "批准流程、修订记录、表单和实施日期",
          "Approved process, revision log, forms, and implementation date",
        ],
        [
          "提供前后差异及岗位操作提示",
          "Provide before-and-after changes and role-specific actions",
        ],
        [
          "受控文件未发布前保留原执行依据",
          "Retain existing controlled procedures until the revision is released",
        ],
      ],
      [
        ["出差安全政策提醒", "Travel safety policy reminder"],
        [
          "说明行前审批、风险信息和紧急联络",
          "Explain pre-travel approval, risk information, and emergency contact",
        ],
        ["差旅政策、审批角色、联系人和适用地区", "Travel policy, approvers, contacts, and regions"],
        [
          "生成行前检查表及应急联系说明",
          "Generate a pre-travel checklist and emergency-contact guidance",
        ],
        [
          "不编造目的地实时安全形势或可用资源",
          "Do not invent current destination risk or available resources",
        ],
      ],
      [
        ["新人制度签收安排", "New hire policy acknowledgment"],
        [
          "安排入职制度阅读、答疑和签收责任",
          "Plan policy reading, questions, and acknowledgment for new hires",
        ],
        [
          "适用制度、版本、生效日、入职角色和负责人",
          "Applicable policies, versions, effective dates, roles, and owners",
        ],
        [
          "交付阅读清单、签收表和答疑安排",
          "Deliver reading lists, acknowledgment forms, and support schedule",
        ],
        [
          "签收记录不得代替能力或实际理解验证",
          "Acknowledgment does not replace verification of competence or understanding",
        ],
      ],
    ],
  }),
  defineFamily({
    id: "forms-survey",
    name: ["问卷与表单设计", "Surveys and forms design"],
    category: "research",
    format: "DOCX",
    summary: [
      "设计问卷题目、选项、跳转与人工配置规格",
      "Design survey questions, options, routing, and manual configuration specifications",
    ],
    style: [
      "题意单一、顺序自然、收集字段最小化",
      "Use single-purpose questions, natural ordering, and minimal data collection",
    ],
    sections: [
      ["目标与对象", "Objectives and audience"],
      ["题目与选项", "Questions and options"],
      ["逻辑及校验", "Routing and validation"],
      ["告知与同意", "Notice and consent"],
      ["统计计划", "Analysis plan"],
      ["测试与交付", "Testing and delivery"],
    ],
    audience: [
      "问卷设计者、业务负责人及受邀填写者",
      "Survey designers, business owners, and invited respondents",
    ],
    playbook: {
      inputs: [
        "明确调查目标、受众、招募方式、问卷语言、预计样本、收集期限、可用工具和个人信息处理规则。收集已有题目及组织授权，提前确定哪些字段确有必要；没有样本或调查结果时不编造答卷、回收率和结论。",
        "Define the survey objective, audience, recruitment, languages, expected sample, collection window, available tools, and personal-data rules. Gather authorized existing questions and identify necessary fields; do not invent responses, response rates, or findings.",
      ],
      method: [
        "将每个决策问题映射到单一目的题目，选择单选、多选、量表或开放题，并写明选项互斥性、必填条件、跳转与异常处理。先以少量目标用户试答，再修改歧义、双重问题和诱导措辞；统计口径按有效答卷与缺失值分别定义。",
        "Map each decision question to a single-purpose item; choose single choice, multiple choice, scale, or open response and specify exclusive options, required fields, routing, and exceptions. Pilot with target users, remove ambiguity and leading wording, and define valid responses and missing values for analysis.",
      ],
      design: [
        "交付可编辑问卷规格，逐题列编号、题干、类型、选项、必填、显示条件和统计用途，另附开场告知、结束文案及人工配置检查表。题目逻辑只描述需人工建立的行为，不宣称在线表单已经创建、发布或采集到数据。",
        "Deliver an editable question specification with ID, wording, type, options, required status, display conditions, and analysis use, plus notices and manual configuration checks. Routing describes work a person must configure and does not claim an online form was created, published, or collecting data.",
      ],
      checks: [
        "逐条检查题目与目标对应、选项覆盖且不重叠、必填与跳转可达、退出和不适用选项合理，并人工走查每条分支。确认告知内容、权限设置、保留期限及无障碍需求由负责人核验；无真实试答和样本时如实标记未验证。",
        "Check objective alignment, exhaustive non-overlapping options, reachable required questions and branches, and appropriate opt-out or not-applicable choices; manually walk every route. Have the owner verify notices, permissions, retention, and accessibility, and disclose absent pilots or samples.",
      ],
    },
    scenarios: [
      [
        ["内部活动报名表", "Internal event registration form"],
        [
          "收集参加意向、场次和必要联系信息",
          "Collect participation, session choice, and necessary contact details",
        ],
        [
          "活动日期、容量、场次、报名期限和处理规则",
          "Event dates, capacity, sessions, registration deadline, and handling rules",
        ],
        [
          "输出报名题目、容量提示及人工配置清单",
          "Output registration questions, capacity notices, and manual setup checks",
        ],
        ["提交表单不等于已确认名额", "Form submission does not confirm a place"],
      ],
      [
        ["培训需求调查", "Training needs survey"],
        [
          "按岗位任务和能力差距确定培训优先级",
          "Prioritize training by job tasks and capability gaps",
        ],
        [
          "目标岗位、能力框架、可选主题及时间限制",
          "Target roles, competency framework, topics, and time limits",
        ],
        [
          "交付需求题目、选项和分组分析计划",
          "Deliver needs questions, options, and segmentation plan",
        ],
        [
          "自评需求不应作为唯一能力证据",
          "Self-reported needs should not be the sole evidence of capability",
        ],
      ],
      [
        ["客户满意度问卷", "Customer satisfaction survey"],
        [
          "分别测量服务体验、问题解决和改进建议",
          "Measure service experience, issue resolution, and suggestions separately",
        ],
        [
          "服务接触点、客户样本、调查期限和授权",
          "Service touchpoints, customer sample, survey window, and consent",
        ],
        ["提供量表、开放题及汇总口径", "Provide scales, open questions, and analysis definitions"],
        [
          "说明样本偏差，匿名性须依据实际配置确认",
          "Disclose sample bias and verify anonymity from actual configuration",
        ],
      ],
      [
        ["会议时间收集表", "Meeting availability form"],
        [
          "收集参与者在候选时段的可用情况",
          "Collect participant availability for proposed time slots",
        ],
        [
          "候选日期、时区、会议时长和参与者范围",
          "Candidate dates, time zones, meeting duration, and participant scope",
        ],
        [
          "制作候选选项与汇总时区说明",
          "Create availability options and time-zone aggregation guidance",
        ],
        [
          "提交可用时间不代表会议已经预约",
          "Submitted availability does not mean a meeting is booked",
        ],
      ],
      [
        ["新员工入职体验调查", "New hire onboarding experience survey"],
        [
          "了解入职资料、支持与系统申请体验",
          "Assess onboarding materials, support, and access-request experience",
        ],
        [
          "入职阶段、可评估事项、反馈使用范围及隐私政策",
          "Onboarding stages, assessable topics, intended feedback use, and privacy policy",
        ],
        [
          "输出分阶段问题、跳转和反馈处理计划",
          "Output phased questions, routing, and feedback handling",
        ],
        [
          "小团队应避免将回答与个人身份不当关联",
          "Avoid inappropriate respondent identification in small teams",
        ],
      ],
      [
        ["活动现场反馈表", "Event feedback form"],
        [
          "收集议程、场地和组织服务的具体反馈",
          "Collect specific feedback on agenda, venue, and organization",
        ],
        ["活动流程、受众、场地及反馈截止时间", "Agenda, audience, venue, and feedback deadline"],
        [
          "提供简短量表、开放题和统计分类",
          "Provide brief scales, open questions, and analysis categories",
        ],
        [
          "不要将现场满意度直接视作长期成效",
          "Do not equate event satisfaction with long-term outcomes",
        ],
      ],
      [
        ["产品功能需求问卷", "Product feature needs survey"],
        [
          "比较用户任务、使用频率与功能痛点",
          "Compare user tasks, frequency, and feature pain points",
        ],
        [
          "目标用户、产品功能现状、研究假设和样本渠道",
          "Target users, existing functionality, hypotheses, and recruitment channels",
        ],
        ["设计中性问题、选项及细分分析", "Design neutral questions, options, and segmentation"],
        [
          "需求意向不等于支付意愿或交付承诺",
          "Interest is not proof of willingness to pay or a delivery commitment",
        ],
      ],
      [
        ["供应商信息调查", "Supplier information questionnaire"],
        [
          "收集经营资质、交付能力和联系人资料",
          "Collect supplier credentials, delivery capacity, and contacts",
        ],
        [
          "采购类别、资质要求、数据使用及回复期限",
          "Purchase category, qualification requirements, data use, and deadline",
        ],
        [
          "交付供应商字段、附件要求及人工核验表",
          "Deliver supplier fields, attachment requirements, and manual verification",
        ],
        [
          "自填资料未核验前不能判为合格供应商",
          "Self-reported data does not establish supplier qualification",
        ],
      ],
      [
        ["员工办公体验调查", "Employee workplace experience survey"],
        ["了解办公工具、协作环境和障碍", "Understand workplace tools, collaboration, and barriers"],
        [
          "调查目的、员工群体、收集范围和隐私告知",
          "Survey purpose, employee groups, collection scope, and privacy notice",
        ],
        [
          "输出中性题目及部门汇总最低样本规则",
          "Output neutral questions and minimum group-reporting rules",
        ],
        [
          "敏感问题允许不答并避免小群体识别",
          "Allow opt-out from sensitive questions and avoid small-group identification",
        ],
      ],
      [
        ["课程知识小测表", "Course knowledge quiz form"],
        ["围绕课程目标编写题目及参考答案", "Write questions and answers around course objectives"],
        [
          "课程内容、学习目标、题数和评分规则",
          "Course content, objectives, question count, and scoring rules",
        ],
        [
          "交付题目、答案映射及人工配置说明",
          "Deliver questions, answer mapping, and manual setup guidance",
        ],
        [
          "未配置在线评分时不得声称已自动批改",
          "Do not claim automatic scoring without configuring it",
        ],
      ],
      [
        ["活动报名候补表", "Event waitlist form"],
        [
          "记录候补顺序、可参加场次和联系授权",
          "Record waitlist order, available sessions, and contact permission",
        ],
        [
          "容量、候补规则、报名时段及退出方式",
          "Capacity, waitlist rules, registration window, and withdrawal method",
        ],
        [
          "形成候补字段、通知模板和人工处理规则",
          "Produce waitlist fields, notification templates, and manual handling rules",
        ],
        [
          "不得承诺候补必然转为正式名额",
          "Do not promise waitlisted participants a confirmed place",
        ],
      ],
      [
        ["项目阶段复盘问卷", "Project phase retrospective survey"],
        [
          "收集协作、交付和改进建议并保留反面意见",
          "Collect collaboration, delivery, and improvement feedback including dissent",
        ],
        [
          "项目阶段、参与角色、复盘问题及反馈使用范围",
          "Project phase, participant roles, retrospective questions, and intended use",
        ],
        [
          "输出问题规格、汇总维度及后续讨论提纲",
          "Output question specifications, analysis dimensions, and discussion agenda",
        ],
        [
          "匿名与保密只能按实际收集配置说明",
          "Describe anonymity and confidentiality only as actually configured",
        ],
      ],
    ],
  }),
];
