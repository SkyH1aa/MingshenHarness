export const LEGACY_SCENARIO_GUIDES_EN_C: Readonly<
  Record<string, readonly (readonly [inputs: string, action: string, check: string])[]>
> = {
  "business-case": [
    [
      "Project costs, benefits, investment timing, and baseline",
      "Calculate incremental value and funding requirements",
      "Define the no-investment case and disclose assumptions",
    ],
    [
      "Regional demand, capacity, investment, and operating costs",
      "Compare expansion timing and returns",
      "Check addressable demand and staffing constraints",
    ],
    [
      "Target users, product investment, pricing, and sales assumptions",
      "Estimate development and launch costs against incremental benefits",
      "Flag unvalidated demand and the possibility of failure",
    ],
    [
      "Market size, entry costs, competition, and regulations",
      "Compare a pilot, partnership, and direct entry",
      "Distinguish obtainable demand from the total market",
    ],
    [
      "Current process volume, working hours, error rates, and automation costs",
      "Estimate hours released and implementation and maintenance costs",
      "Do not equate released hours with redundancy savings",
    ],
    [
      "Equipment condition, maintenance spending, energy use, and replacement quotes",
      "Compare the full cost of continued maintenance and replacement",
      "Check downtime, residual value, and safety constraints",
    ],
    [
      "Current system costs, failures, upgrade quotes, and migration plans",
      "Compare upgrading with maintaining the current system",
      "Include migration, training, and rollback costs",
    ],
    [
      "Internal service costs, outsourcing quotes, and service levels",
      "Compare the total ownership cost of internal delivery and outsourcing",
      "Check service boundaries and exit costs",
    ],
    [
      "Pilot results, sample characteristics, expansion costs, and delivery capacity",
      "Assess expansion gates and staged investment",
      "Do not extrapolate a small sample without qualification",
    ],
    [
      "Capacity utilization, demand forecasts, investment, and lead times",
      "Compare added capacity, outsourcing, and deferral",
      "Test demand sensitivity and revisit bottlenecks",
    ],
    [
      "Suppliers, logistics, inventory, and switching costs",
      "Compare the cost and resilience effects of supply-chain changes",
      "Check contractual, transition, and continuity risks",
    ],
    [
      "Partnership goals, each party's investment, benefit allocation, and agreements",
      "Estimate the joint project's incremental value",
      "Identify unsigned terms and exit conditions",
    ],
  ],
  "product-spec": [
    [
      "User tasks, business objectives, constraints, and research evidence",
      "Define requirements, flows, states, and acceptance criteria",
      "Identify exclusions and unresolved decisions",
    ],
    [
      "Existing behavior, feedback, problem data, and limitations",
      "Describe current and target behavior and migration effects",
      "Do not treat a proposed solution as a validated need",
    ],
    [
      "Current workflows, user tasks, and evidence of friction",
      "Compare existing and improved steps, including exception paths",
      "Check permissions, accessibility, and recovery",
    ],
    [
      "Service catalog, user permissions, entry points, and support processes",
      "Design self-service tasks and support when completion is impossible",
      "Prevent unauthorized access and misleading success states",
    ],
    [
      "Trigger events, channels, audiences, and notification preferences",
      "Define delivery, deduplication, failure, and dismissal behavior",
      "Check privacy, frequency, and authorization",
    ],
    [
      "Account fields, permissions, devices, and current settings",
      "Define viewing, editing, validation, and recovery",
      "Protect sensitive information and session security",
    ],
    [
      "File formats, field mappings, size limits, and error samples",
      "Define preview, validation, import, and failure recovery",
      "Prevent silently dropped rows and unintended overwrites",
    ],
    [
      "Approval roles, triggers, authority, and exceptions",
      "Define submission, approval, rejection, and withdrawal",
      "Make permission decisions and approval records traceable",
    ],
    [
      "Legacy feature usage, replacement capabilities, and compatibility constraints",
      "Design transition, communication, and rollback paths",
      "Identify users without an adequate replacement",
    ],
    [
      "Version differences, data formats, and user environments",
      "Specify migration checks, execution, and recovery",
      "Preserve data and verify the supported compatibility range",
    ],
    [
      "Pilot users, tasks, metrics, and time limits",
      "Bound the pilot and organize feedback",
      "Define exit and expansion conditions",
    ],
    [
      "Legacy dependencies, user impact, and the retirement plan",
      "Plan notices, alternatives, and service shutdown",
      "Check data-export needs and contractual obligations",
    ],
  ],
  "ux-research": [
    [
      "Business decisions, target users, existing evidence, and unknowns",
      "Design open questions for needs discovery",
      "Do not mistake a predetermined solution for a user need",
    ],
    [
      "Recruitment criteria, interview guide, and consent records",
      "Conduct semi-structured interviews and synthesize themes",
      "Protect identities and distinguish quotations from interpretation",
    ],
    [
      "Task setting, people observed, authorization, and recording method",
      "Record actual steps, obstacles, and workarounds",
      "Avoid disrupting work or inferring unspoken motives",
    ],
    [
      "Locations, devices, context, and participants",
      "Record environmental influences and task constraints",
      "Limit disclosure of sensitive contextual material",
    ],
    [
      "Prototype version, tasks, participants, and success criteria",
      "Observe interactions and record points of failure",
      "Disclose prototype limitations and sample size",
    ],
    [
      "Existing workflow, task goals, and recruitment population",
      "Record paths, completion rates, and recovery behavior",
      "Do not inflate success rates through researcher prompting",
    ],
    [
      "Information architecture, content labels, and retrieval tasks",
      "Evaluate categorization, navigation, and retrieval paths",
      "Keep unsuccessful searches and misclassifications in the evidence",
    ],
    [
      "Mobile devices, critical tasks, and operating conditions",
      "Observe touch interactions, information density, and interruptions",
      "Disclose device, network, and sample limitations",
    ],
    [
      "Journey stages, touchpoints, user feedback, and ownership",
      "Map behaviors, pain points, and opportunities",
      "Separate observations from inferences using evidence",
    ],
    [
      "Churn definition, former-user feedback, and contact records",
      "Analyze the departure journey and hypotheses to test",
      "Do not mistake correlation for causation",
    ],
    [
      "Service channels, steps, and user and employee feedback",
      "Compare experience breaks between touchpoints",
      "Include cross-channel handoffs",
    ],
    [
      "Adoption funnel, first-use records, and interviews",
      "Identify onboarding barriers and support opportunities",
      "Distinguish inability to complete from unwillingness to use",
    ],
  ],
  "release-readiness": [
    [
      "Candidate build, changes, tests, and release checklist",
      "Evaluate blockers, operational coverage, and the release decision",
      "Never mark missing tests as passed",
    ],
    [
      "Incident impact, fix scope, verification, and rollback",
      "Shorten decision turnaround while retaining essential checks",
      "Record risks that remain untested",
    ],
    [
      "Rollout cohorts, observation metrics, thresholds, and monitoring",
      "Define expansion, pause, and rollback gates",
      "Confirm each cohort's owner and observation window",
    ],
    [
      "Pilot users, candidate version, feedback, and support",
      "Arrange controlled trials and acceptance review",
      "Confirm pilot boundaries and exit conditions",
    ],
    [
      "Migration scripts, backups, compatibility, and recovery plan",
      "Review migration order and verification results",
      "Do not claim rollback readiness without a recovery rehearsal",
    ],
    [
      "Interface contracts, callers, compatibility period, and tests",
      "Plan version compatibility and caller notifications",
      "Check breaking changes and monitoring",
    ],
    [
      "Infrastructure configuration, dependencies, capacity, and rollback",
      "Review change steps, observation, and recovery",
      "Do not directly implement changes in an unknown environment",
    ],
    [
      "Configuration differences, effective scope, defaults, and rollback",
      "Review changes and staged application conditions",
      "Do not expose sensitive configuration",
    ],
    [
      "Customer environments, upgrade cohorts, support, and migration materials",
      "Arrange notification, implementation, and acceptance",
      "Record incompatible environments and failure recovery",
    ],
    [
      "Default changes, affected users, and opt-out controls",
      "Define staged activation and support readiness",
      "Verify user choice and restoration paths",
    ],
    [
      "Legacy features, alternatives, migration records, and customers",
      "Track migrations, issues, and support",
      "Do not presume customers have migrated without evidence",
    ],
    [
      "Retirement scope, dependent parties, notices, and data exports",
      "Set the shutdown schedule, checks, and contingencies",
      "Check contractual and data-retention obligations",
    ],
  ],
  "architecture-decision": [
    [
      "Business capabilities, team responsibilities, interfaces, and load",
      "Compare service boundaries and dependency direction",
      "Check consistency requirements and cross-service failures",
    ],
    [
      "Data model, read/write patterns, recovery objectives, and constraints",
      "Compare storage options and migration paths",
      "Review backup, recovery, and access control",
    ],
    [
      "System interfaces, data contracts, coupling, and latency",
      "Compare synchronous, event-based, and batch integration",
      "Record failure, idempotency, and version constraints",
    ],
    [
      "Task types, throughput, ordering, and timeliness",
      "Design queues, consumers, and retries",
      "Check duplication, backlog, and dead-letter handling",
    ],
    [
      "Principals, roles, resources, and identity systems",
      "Design authentication and least-privilege authorization",
      "Review permission inheritance and revocation",
    ],
    [
      "Failure modes, recovery objectives, backups, and dependencies",
      "Compare isolation, failover, and recovery approaches",
      "Distinguish intended objectives from measured capabilities",
    ],
    [
      "Service metrics, logs, traces, and alerting needs",
      "Plan collection, correlation, and fault diagnosis",
      "Protect sensitive data and control cardinality",
    ],
    [
      "Credential types, consumers, rotation, and storage",
      "Compare secret management and access workflows",
      "Never include real secrets in the document",
    ],
    [
      "Requirements, candidate frameworks, maintenance, and ecosystem",
      "Compare constraints, migration, and long-term costs",
      "Record versions and validation evidence",
    ],
    [
      "Environments, release frequency, operations, and isolation requirements",
      "Compare deployment models, rollback, and resources",
      "Check the actual environment and failure recovery",
    ],
    [
      "Interface versions, callers, and support lifecycle",
      "Define compatibility policy and migration timing",
      "Record breaking changes and exceptions",
    ],
    [
      "Module responsibilities, dependency graph, data, and tests",
      "Choose decomposition boundaries and implementation order",
      "Avoid circular dependencies and expanded privileges",
    ],
  ],
  "onboarding-program": [
    [
      "Onboarding process, role, contacts, and introductory materials",
      "Plan first-day, first-week, and first-quarter tasks",
      "Verify account permissions and feedback checkpoints",
    ],
    [
      "Development environment, repository permissions, engineering standards, and mentor",
      "Arrange environment verification, a small first task, and review",
      "Avoid exposing credentials or granting excessive access",
    ],
    [
      "Operating workflows, metrics, tools, and team interfaces",
      "Arrange observation, guided practice, and independent delivery",
      "Check data access and metric definitions",
    ],
    [
      "Sales process, product materials, customer policies, and mentor",
      "Design product learning, shadowing, and simulated conversations",
      "Do not promise customer terms without authorization",
    ],
    [
      "Team context, management responsibilities, objectives, and manager expectations",
      "Plan team interviews, handoffs, and first-90-day actions",
      "Separate observations from unverified judgments",
    ],
    [
      "Old and new responsibilities, open work, handoff owners, and authority",
      "Plan responsibility transfer and adjustment to the new role",
      "Confirm unfinished work and access rights",
    ],
    [
      "Old and new team interfaces, resources, and timing",
      "Plan the transfer handoff and supplementary learning",
      "Protect employee information and review permissions",
    ],
    [
      "Team goals, open issues, decisions, and key relationships",
      "Organize leadership handover and staged reviews",
      "Preserve historical decisions and risk records",
    ],
    [
      "Remote equipment, accounts, time zones, and communication channels",
      "Arrange remote connectivity, pairing, and support",
      "Check security configuration and accessibility",
    ],
    [
      "Internship duration, learning objectives, mentor, and tasks",
      "Design stage-appropriate tasks and feedback",
      "Clarify supervision and data-access boundaries",
    ],
    [
      "Onboarding cohorts, headcount, instructors, equipment, and dates",
      "Schedule shared training and individual follow-up",
      "Check capacity and make-up arrangements for absences",
    ],
    [
      "Return-to-work duties, policy changes, equipment, and support",
      "Plan a transition and knowledge refresh",
      "Respect privacy and avoid unauthorized personal inferences",
    ],
  ],
  "performance-review": [
    [
      "Quarterly goals, results, factual evidence, and employee feedback",
      "Discuss outcomes, obstacles, and next steps against goals",
      "Allow the employee to add context and disagreements",
    ],
    [
      "Annual goals, project outcomes, feedback, and role context",
      "Summarize achievements and development priorities",
      "Verify the review period and assessment evidence",
    ],
    [
      "Project objectives, contributions, deliverables, and collaboration records",
      "Review individual roles, outcomes, and lessons",
      "Separate team outcomes from individual contribution",
    ],
    [
      "Stage goals, milestones, resources, and changes",
      "Compare expectations with results and adjust actions",
      "Explain changed objectives and external influences",
    ],
    [
      "Professional standards, work samples, and development goals",
      "Design practice, mentoring feedback, and checkpoints",
      "Avoid vague competency labels",
    ],
    [
      "Management responsibilities, team feedback, and actual situations",
      "Plan delegation, feedback, and decision exercises",
      "Protect feedback sources and employee privacy",
    ],
    [
      "Cross-team tasks, handoff feedback, and concrete behavior",
      "Identify collaboration strengths and actions to improve",
      "Use behavioral evidence rather than personality inferences",
    ],
    [
      "Role requirements, current skills, interests, and resources",
      "Plan a development path and staged practice",
      "Do not promise an unapproved promotion",
    ],
    [
      "Probation objectives, coaching records, deliverables, and feedback",
      "Review objective attainment and support needs",
      "Check the formal process and decision authority",
    ],
    [
      "Role changes, handoff goals, and actual performance",
      "Assess adjustment and support for the next stage",
      "Consider environmental changes and preparation time",
    ],
    [
      "Target-role standards, work evidence, and existing responsibilities",
      "Assess readiness and remaining gaps",
      "Do not equate a recommendation with promotion approval",
    ],
    [
      "Original goals, reasons for adjustment, approvals, and new resources",
      "Compare outcomes and responsibilities before and after adjustment",
      "Avoid assessing against obsolete goals",
    ],
  ],
  "incident-review": [
    [
      "Service alerts, logs, timeline, and impact data",
      "Analyze detection, mitigation, recovery, and systemic causes",
      "Normalize time zones and retain unknowns",
    ],
    [
      "Performance metrics, load, changes, and user feedback",
      "Locate degradation windows and possible contributors",
      "Separate observation, hypotheses, and verified root causes",
    ],
    [
      "Release records, code changes, monitoring, and rollback records",
      "Compare release and incident timing and analyze safeguards",
      "Do not label a release the root cause without evidence",
    ],
    [
      "Dependency status, call records, and timeout configuration",
      "Analyze propagation, degradation modes, and recovery",
      "Verify third-party facts and responsibility boundaries",
    ],
    [
      "Data-processing records, affected scope, and control evidence",
      "Build the timeline and impact and recovery checks",
      "Preserve evidence and escalate as required",
    ],
    [
      "Permission changes, audit logs, roles, and affected accounts",
      "Review authorization and control gaps",
      "Avoid disclosing account details or sensitive records",
    ],
    [
      "Configuration versions, release records, alerts, and recovery steps",
      "Analyze configuration changes, review, and rollback",
      "Do not publish sensitive configuration in the report",
    ],
    [
      "Confirmed exposure scope, access logs, and response records",
      "Record containment, notices, and follow-up verification",
      "Do not interpret unknown impact as zero impact",
    ],
    [
      "Plans, dependencies, actual delivery, and communications",
      "Analyze delay conditions and improvement actions",
      "Verify dates and avoid personal blame",
    ],
    [
      "Defect records, acceptance criteria, impact, and fixes",
      "Analyze escaped defects and quality controls",
      "Check fix and retest status",
    ],
    [
      "Communications, roles, key decisions, and timing",
      "Identify lost information and delayed escalation",
      "Separate recorded facts from participants' views",
    ],
    [
      "Operation records, process versions, environment, and impact",
      "Find gaps in process design and error-prevention controls",
      "Preserve evidence and avoid blaming individuals",
    ],
  ],
  "governance-review": [
    [
      "Governance authority, annual objectives, risks, and meeting records",
      "Assess governance duties, decisions, and continuous improvement",
      "Disclose review boundaries and evidence limitations",
    ],
    [
      "Control objectives, execution records, samples, and exceptions",
      "Inspect control design and actual execution",
      "Sampled success does not prove comprehensive effectiveness",
    ],
    [
      "Risk register, ratings, controls, and owners",
      "Review risk movements and treatment priorities",
      "Record rating evidence and review dates",
    ],
    [
      "Remediation items, committed dates, evidence, and retest results",
      "Track overdue work, closure, and residual risk",
      "Action completion alone does not establish a passed retest",
    ],
    [
      "Supplier categories, qualifications, performance, and contracts",
      "Review onboarding, monitoring, and exit governance",
      "Disclose sample coverage and missing evidence",
    ],
    [
      "Purchase requests, approvals, orders, and supplier records",
      "Check authority, quote comparisons, and separation of duties",
      "Do not invent policy thresholds or approval records",
    ],
    [
      "Outsourcing contracts, service levels, access, and reports",
      "Review delivery, controls, and exit arrangements",
      "Distinguish supplier claims from actual evidence",
    ],
    [
      "Authority matrix, spending approvals, and financial records",
      "Sample consistency between permissions and payment workflows",
      "Check authority versions and exception approvals",
    ],
    [
      "Account inventory, roles, approvals, and departure records",
      "Sample permission suitability and periodic reviews",
      "Handle account information only within authorized scope",
    ],
    [
      "Data assets, owners, classification, and processing records",
      "Review data responsibilities, use, and exceptions",
      "Disclose sampling and data-access limitations",
    ],
    [
      "Record inventory, retention policy, storage, and destruction evidence",
      "Check retention periods and expiry handling",
      "Have actual policies and qualified reviewers confirm legal periods",
    ],
    [
      "Current policies, training, execution records, and exceptions",
      "Assess gaps between policy communication and execution",
      "Record policy versions and people outside the reviewed coverage",
    ],
  ],
};
