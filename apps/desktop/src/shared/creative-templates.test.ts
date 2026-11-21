import { describe, expect, it } from "vitest";
import { EXTENDED_CREATIVE_FAMILIES_A } from "./creative-template-families-a";
import { EXTENDED_CREATIVE_FAMILIES_B } from "./creative-template-families-b";
import { EXTENDED_CREATIVE_FAMILIES_C } from "./creative-template-families-c";
import { LEGACY_SCENARIO_GUIDES } from "./creative-template-legacy-cases";
import { CREATIVE_FAMILY_SCENARIOS } from "./creative-template-scenarios";
import {
  buildCreativeTemplatePrompt,
  CREATIVE_TEMPLATE_CATEGORIES,
  CREATIVE_TEMPLATES,
  createCreativeDraft,
  creativeCategoryLabel,
  creativeSkillsForDraft,
  findCreativeTemplate,
  parseCreativeDeliverableFormat,
  parseCreativeWorkspaceDraft,
} from "./creative-templates";

describe("creative workstation template catalog", () => {
  const legacyVariantIds = [
    "executive",
    "board",
    "investor",
    "client",
    "internal-team",
    "workshop",
    "sales",
    "public",
    "technical",
    "beginner",
    "decision",
    "retrospective",
  ];

  it("publishes family-specific scenarios without changing any legacy identifiers", () => {
    expect(CREATIVE_TEMPLATES).toHaveLength(780);
    const families = new Map<string, typeof CREATIVE_TEMPLATES>();
    for (const template of CREATIVE_TEMPLATES) {
      const group = families.get(template.familyId) ?? [];
      families.set(template.familyId, [...group, template]);
    }
    expect(families.size).toBe(65);
    for (const [familyId, templates] of families) {
      expect(templates, familyId).toHaveLength(12);
      expect(templates.map((template) => template.variantId)).toEqual(legacyVariantIds);
      if (familyId in CREATIVE_FAMILY_SCENARIOS) {
        expect(new Set(templates.map((template) => template.defaultAudience)).size).toBe(3);
        expect(new Set(templates.map((template) => template.acceptance[3])).size).toBe(3);
      }
      for (const template of templates) {
        expect(template.id).toBe(`${familyId}--${template.variantId}`);
        expect(
          template.sections.some((section) => section.id === `variant-${template.variantId}`),
        ).toBe(true);
      }
    }
  });

  it("matches lesson, incident, finance and product scenarios to appropriate audiences and checks", () => {
    const lesson = findCreativeTemplate("lesson-plan--investor");
    expect(lesson?.name).toContain("课堂练习课");
    expect(lesson?.defaultAudience).toContain("教师");
    expect(lesson?.acceptance.join(" ")).toContain("学生练习");
    expect(
      `${lesson?.name} ${lesson?.defaultAudience} ${lesson?.acceptance.join(" ")}`,
    ).not.toMatch(/投资人|单位经济|资金需求/);

    const incident = findCreativeTemplate("incident-review--beginner");
    expect(incident?.name).toContain("质量缺陷事件");
    expect(incident?.defaultAudience).toContain("处置团队");
    expect(incident?.acceptance.join(" ")).toContain("纠正行动");
    expect(
      `${incident?.name} ${incident?.defaultAudience} ${incident?.acceptance.join(" ")}`,
    ).not.toMatch(/入门教学|小练习|学员/);

    const finance = findCreativeTemplate("financial-model--decision");
    expect(finance?.name).toContain("收入情景分析");
    expect(finance?.acceptance.join(" ")).toContain("现金需求");
    const product = findCreativeTemplate("product-spec--technical");
    expect(product?.name).toContain("功能替换");
    expect(product?.acceptance.join(" ")).toContain("迁移影响");
  });

  it("calculates part-time budget and actual FTE from comparable hours, not pay rates", () => {
    const item = findCreativeTemplate("compensation-planning--beginner");
    if (!item) throw new Error("Missing part-time budget fixture");
    for (const mode of ["brief", "detailed"] as const) {
      const zhDraft = createCreativeDraft(item);
      zhDraft.promptMode = mode;
      const zh = buildCreativeTemplatePrompt(item, zhDraft);
      expect(zh).toContain("预算工时÷同期间全职工时");
      expect(zh).toContain("实际工时÷同期间全职工时");
      expect(zh).toContain("时薪仅用于计算工资费用");
      expect(zh).toContain("基准缺失或为零时标记无法计算");
      expect(zh).toContain("不将合法排班或个体差异直接认定违规");
      expect(zh).not.toContain("按合同小时、实际排班与时薪计算人员当量");

      const enDraft = createCreativeDraft(item, "en");
      enDraft.promptMode = mode;
      const en = buildCreativeTemplatePrompt(item, enDraft, "en");
      expect(en).toContain("budget hours divided by full-time hours for that period");
      expect(en).toContain("actual hours divided by full-time hours for that period");
      expect(en).toContain("Use hourly rates only for wage costs");
      expect(en).toContain("baseline is missing or zero");
      expect(en).toContain(
        "without treating lawful schedules or individual differences as violations",
      );
      expect(en).not.toContain("calculate FTE from contracted hours, rostered actuals, and rates");
    }
  });

  it("limits poster PDF wording to supported page sizes and does not promise press output", () => {
    for (const template of CREATIVE_TEMPLATES.filter(
      (item) => item.familyId === "poster-campaign",
    )) {
      const draft = createCreativeDraft(template);
      const text = [
        template.summary,
        template.summaryEn,
        ...template.sections.flatMap((section) => [
          section.title,
          section.titleEn,
          section.intent,
          section.intentEn,
        ]),
        ...template.acceptance,
        ...template.acceptanceEn,
        ...template.workflow,
        ...template.workflowEn,
        draft.style,
        buildCreativeTemplatePrompt(template, draft),
      ].join("\n");
      expect(text).toContain("A4");
      expect(text).toContain("Letter");
      expect(text).not.toMatch(
        /可印刷|印刷安全|出血|CMYK|print.ready|print.safe|print.credible|bleed/i,
      );
    }
  });

  it("keeps identifiers, names, sections, and acceptance criteria usable", () => {
    expect(new Set(CREATIVE_TEMPLATES.map((template) => template.id)).size).toBe(
      CREATIVE_TEMPLATES.length,
    );
    expect(new Set(CREATIVE_TEMPLATES.map((template) => template.name)).size).toBe(
      CREATIVE_TEMPLATES.length,
    );
    expect(new Set(CREATIVE_TEMPLATES.map((template) => template.nameEn)).size).toBe(
      CREATIVE_TEMPLATES.length,
    );
    for (const template of CREATIVE_TEMPLATES) {
      expect(template.sections.length, template.id).toBeGreaterThanOrEqual(7);
      expect(new Set(template.sections.map((section) => section.id)).size, template.id).toBe(
        template.sections.length,
      );
      expect(template.acceptance.length, template.id).toBeGreaterThanOrEqual(5);
      expect(template.acceptanceEn.length, template.id).toBe(template.acceptance.length);
      expect(template.workflow.length, template.id).toBeGreaterThanOrEqual(4);
      expect(template.workflowEn.length, template.id).toBe(template.workflow.length);
      expect(template.tags.length, template.id).toBeGreaterThanOrEqual(6);
      for (const section of template.sections) {
        expect(section.title.trim(), template.id).not.toBe("");
        expect(section.titleEn.trim(), template.id).not.toBe("");
        expect(section.intent.trim(), template.id).not.toBe("");
        expect(section.intentEn.trim(), template.id).not.toBe("");
      }
    }
  });

  it("covers every template category and resolves localized labels", () => {
    const represented = new Set(CREATIVE_TEMPLATES.map((template) => template.category));
    for (const category of CREATIVE_TEMPLATE_CATEGORIES) {
      expect(represented.has(category.id), category.id).toBe(true);
      expect(creativeCategoryLabel(category.id)).toBe(category.label);
      expect(creativeCategoryLabel(category.id, "en")).toBe(category.labelEn);
    }
  });

  it("keeps a balanced catalog across every output category", () => {
    const counts = new Map<string, number>();
    for (const template of CREATIVE_TEMPLATES) {
      counts.set(template.category, (counts.get(template.category) ?? 0) + 1);
    }
    expect([...counts.values()].every((count) => count >= 12)).toBe(true);
    expect([...counts.values()].reduce((sum, count) => sum + count, 0)).toBe(780);
  });

  it("retains all 348 original IDs and requires a case guide for every original scenario", () => {
    expect(Object.keys(CREATIVE_FAMILY_SCENARIOS)).toHaveLength(29);
    expect(Object.keys(LEGACY_SCENARIO_GUIDES)).toHaveLength(29);
    for (const familyId of Object.keys(CREATIVE_FAMILY_SCENARIOS)) {
      expect(LEGACY_SCENARIO_GUIDES[familyId], familyId).toHaveLength(12);
      for (const [index, variantId] of legacyVariantIds.entries()) {
        const template = findCreativeTemplate(`${familyId}--${variantId}`);
        const guide = LEGACY_SCENARIO_GUIDES[familyId]?.[index];
        expect(template, `${familyId}--${variantId}`).not.toBeNull();
        expect(
          guide?.every((item) => item.trim().length > 0),
          template?.id,
        ).toBe(true);
      }
    }
  });

  it("provides recommended skill metadata and scenario-specific plan fields", () => {
    const families = new Map<string, typeof CREATIVE_TEMPLATES>();
    for (const template of CREATIVE_TEMPLATES) {
      expect(template.detailedDescription.trim(), template.id).not.toBe("");
      expect(template.detailedDescriptionEn.trim(), template.id).not.toBe("");
      expect(template.recommendedSkills.length, template.id).toBeGreaterThanOrEqual(2);
      for (const skill of template.recommendedSkills) {
        expect(skill.id, template.id).toMatch(/^builtin:/);
        expect(skill.reason.trim(), template.id).not.toBe("");
        expect(skill.reasonEn.trim(), template.id).not.toBe("");
      }
      const family = families.get(template.familyId) ?? [];
      families.set(template.familyId, [...family, template]);
    }
    for (const [familyId, templates] of families) {
      const playbook = templates[0]?.detailedPlan.playbook;
      expect(playbook, familyId).toBeDefined();
      if (!playbook) throw new Error(`Missing playbook for ${familyId}`);
      for (const part of ["inputs", "method", "design", "checks"] as const) {
        const han = playbook[part].zh.match(/\p{Script=Han}/gu)?.length ?? 0;
        expect(han, `${familyId} ${part}: ${han} Han characters`).toBeGreaterThanOrEqual(80);
        expect(playbook[part].en.trim(), `${familyId} ${part}`).not.toBe("");
      }
      for (const field of ["inputs", "focus", "output", "risk"] as const) {
        for (const language of ["zh", "en"] as const) {
          const values = templates.map((template) => template.detailedPlan[field][language]);
          expect(
            values.every((value) => value.trim().length > 0),
            `${familyId} ${field} ${language}`,
          ).toBe(true);
          expect(new Set(values).size, `${familyId} ${field} ${language}`).toBe(12);
        }
      }
      for (const template of templates) {
        const parts = [
          template.detailedPlan.inputs.zh,
          template.detailedPlan.focus.zh,
          template.detailedPlan.output.zh,
          template.detailedPlan.risk.zh,
        ];
        if (familyId in CREATIVE_FAMILY_SCENARIOS) {
          const han = parts.join("").match(/\p{Script=Han}/gu)?.length ?? 0;
          expect(han, `${template.id} scenario: ${han} Han characters`).toBeGreaterThanOrEqual(180);
          for (const part of parts) {
            const length = part.match(/\p{Script=Han}/gu)?.length ?? 0;
            expect(
              length,
              `${template.id} scenario field: ${length} Han characters`,
            ).toBeGreaterThanOrEqual(35);
          }
        }
      }
    }
  });

  it("keeps extended brief prompts independent from detailed scene text", () => {
    for (const family of [
      ...EXTENDED_CREATIVE_FAMILIES_A,
      ...EXTENDED_CREATIVE_FAMILIES_B,
      ...EXTENDED_CREATIVE_FAMILIES_C,
    ]) {
      for (const [index, scenario] of family.scenarios.entries()) {
        const template = findCreativeTemplate(`${family.id}--${legacyVariantIds[index]}`);
        expect(template, family.id).not.toBeNull();
        if (!template || !scenario.brief)
          throw new Error(`Missing brief scenario: ${template?.id}`);
        const section = template.sections.find(
          (item) => item.id === `variant-${template.variantId}`,
        );
        expect(section?.intent, template.id).toBe(scenario.brief.focus[0]);
        expect(section?.intentEn, template.id).toBe(scenario.brief.focus[1]);
        expect(template.acceptance.slice(-2), template.id).toEqual([
          scenario.brief.output[0],
          scenario.brief.risk[0],
        ]);
        expect(template.acceptanceEn.slice(-2), template.id).toEqual([
          scenario.brief.output[1],
          scenario.brief.risk[1],
        ]);
        const brief = buildCreativeTemplatePrompt(template, {
          ...createCreativeDraft(template),
          promptMode: "brief",
        });
        expect(brief, template.id).not.toContain(template.detailedPlan.inputs.zh);
        for (const field of ["focus", "output", "risk"] as const) {
          if (template.detailedPlan[field].zh !== scenario.brief[field][0]) {
            expect(brief, `${template.id}: ${field}`).not.toContain(
              template.detailedPlan[field].zh,
            );
          }
        }
      }
    }
  });

  it("contains distinct scene-specific business content without duplicating other fields", () => {
    const families = new Map<string, typeof CREATIVE_TEMPLATES>();
    for (const template of CREATIVE_TEMPLATES) {
      const templates = families.get(template.familyId) ?? [];
      families.set(template.familyId, [...templates, template]);
    }
    const fields = ["inputs", "focus", "output", "risk"] as const;
    const commonAffixes = (values: string[]): [number, number] => {
      const first = values[0];
      if (first === undefined) throw new Error("A template family must contain scenarios");
      let prefix = 0;
      while (values.every((value) => prefix < value.length && value[prefix] === first[prefix])) {
        prefix += 1;
      }
      let suffix = 0;
      while (
        values.every(
          (value) =>
            prefix + suffix < value.length &&
            value[value.length - suffix - 1] === first[first.length - suffix - 1],
        )
      ) {
        suffix += 1;
      }
      return [prefix, suffix];
    };
    for (const [familyId, templates] of families) {
      const affixes = fields.map((field) =>
        commonAffixes(templates.map((template) => template.detailedPlan[field].zh)),
      );
      for (const template of templates) {
        const distinctive = fields.map((field, index) => {
          const value = template.detailedPlan[field].zh;
          const affix = affixes[index];
          if (!affix) throw new Error(`Missing affixes for ${field}`);
          const [prefix, suffix] = affix;
          return value.slice(prefix, value.length - suffix);
        });
        const han = distinctive.join("").match(/\p{Script=Han}/gu)?.length ?? 0;
        expect(
          han,
          `${template.id}: ${han} Han after shared family affixes`,
        ).toBeGreaterThanOrEqual(100);
        for (const language of ["zh", "en"] as const) {
          const values = fields.map((field) => template.detailedPlan[field][language].trim());
          for (const [index, value] of values.entries()) {
            for (const [otherIndex, other] of values.entries()) {
              if (index !== otherIndex)
                expect(
                  value,
                  `${familyId}: ${fields[index]} contains ${fields[otherIndex]}`,
                ).not.toContain(other);
            }
          }
        }
      }
    }
  });

  it("generates at least 800 Han characters for every detailed Chinese prompt", () => {
    for (const template of CREATIVE_TEMPLATES) {
      const prompt = buildCreativeTemplatePrompt(template, createCreativeDraft(template));
      const han = prompt.match(/\p{Script=Han}/gu)?.length ?? 0;
      expect(han, `${template.id}: ${han} Han characters`).toBeGreaterThanOrEqual(800);
      expect(prompt, template.id).toContain(template.detailedPlan.inputs.zh);
      expect(prompt, template.id).toContain(template.detailedPlan.focus.zh);
      expect(prompt, template.id).toContain(template.detailedPlan.output.zh);
      expect(prompt, template.id).toContain(template.detailedPlan.risk.zh);
      expect(prompt, template.id).toContain("use_skill");
      expect(prompt, template.id).toContain("未验证");
      expect(prompt, template.id).not.toContain("。。");
      for (const skill of template.recommendedSkills)
        expect(prompt, template.id).toContain(skill.id);
    }
  });
});

describe("creative workstation drafts and execution prompts", () => {
  const template = findCreativeTemplate("financial-model--decision");

  it("creates a structured draft matching the selected template", () => {
    expect(template).not.toBeNull();
    if (!template) return;
    const draft = createCreativeDraft(template);
    expect(draft.templateId).toBe(template.id);
    expect(draft.promptMode).toBe("detailed");
    expect(draft.deliverable).toBe("XLSX");
    expect(draft.sections).toHaveLength(template.sections.length);
    expect(draft.sections.map((section) => section.title)).toEqual(
      template.sections.map((section) => section.title),
    );
    expect(draft.audience).toBe(template.defaultAudience);
    expect(draft.purpose).toBe(template.summary);
  });

  it("builds a complete Chinese WorkAgent execution request without claiming execution", () => {
    expect(template).not.toBeNull();
    if (!template) return;
    const draft = createCreativeDraft(template);
    draft.subject = "2027 年扩产方案";
    const firstSection = draft.sections[0];
    expect(firstSection).toBeDefined();
    if (!firstSection) return;
    firstSection.notes = "只使用财务部已确认的基准假设。";
    const prompt = buildCreativeTemplatePrompt(template, draft, "zh-CN", "C:\\work\\project");
    expect(prompt).toContain(`「${template.name}」`);
    expect(prompt).toContain("【工作请求】");
    expect(prompt).toContain("2027 年扩产方案");
    expect(prompt).toContain("只使用财务部已确认的基准假设。");
    expect(prompt).toContain("【验收标准】");
    expect(prompt).toContain("【执行规则】");
    expect(prompt).toContain("read_document");
    expect(prompt).toContain("office_document");
    expect(prompt).toContain("C:\\work\\project");
    expect(prompt).toContain("未验证");
    expect(prompt).not.toContain("已执行");
  });

  it("builds the English prompt with localized sections and verification rules", () => {
    expect(template).not.toBeNull();
    if (!template) return;
    const draft = createCreativeDraft(template, "en");
    const prompt = buildCreativeTemplatePrompt(template, draft, "en", null);
    expect(prompt).toContain(template.nameEn);
    expect(prompt).toContain("WORK REQUEST");
    expect(prompt).toContain("ACCEPTANCE CRITERIA");
    expect(prompt).toContain("read_document");
    expect(prompt).toContain("unverified");
  });

  it("keeps the original brief prompt available and adds the detailed plan only when selected", () => {
    if (!template) throw new Error("Missing fixture");
    const detailed = createCreativeDraft(template);
    const brief = { ...detailed, promptMode: "brief" as const };
    const { promptMode: _unusedMode, ...legacy } = detailed;
    const shortPrompt = buildCreativeTemplatePrompt(template, brief);
    const detailedText = buildCreativeTemplatePrompt(template, detailed);
    expect(buildCreativeTemplatePrompt(template, legacy)).toBe(shortPrompt);
    expect(shortPrompt).not.toContain("【详细场景工作说明】");
    expect(detailedText).toContain("【详细场景工作说明】");
    expect(detailedText).toContain(template.detailedPlan.inputs.zh);
    expect(detailedText).toContain(template.detailedPlan.focus.zh);
    expect(detailedText).toContain(template.detailedPlan.risk.zh);
    const english = buildCreativeTemplatePrompt(
      template,
      createCreativeDraft(template, "en"),
      "en",
    );
    expect(english).toContain(template.detailedPlan.inputs.en);
    expect(english).toContain(template.detailedPlan.focus.en);
    expect(english).toContain(template.detailedPlan.risk.en);
  });

  it("updates format-specific skill references when a draft changes its deliverable", () => {
    if (!template) throw new Error("Missing fixture");
    const draft = createCreativeDraft(template);
    expect(creativeSkillsForDraft(template, draft).map((skill) => skill.id)).toContain(
      "builtin:work-spreadsheets",
    );
    draft.deliverable = "PPTX";
    const changedIds = creativeSkillsForDraft(template, draft).map((skill) => skill.id);
    expect(changedIds).toContain("builtin:work-presentations");
    expect(changedIds).toContain("builtin:work-ppt-master");
    expect(changedIds).not.toContain("builtin:work-spreadsheets");
    const prompt = buildCreativeTemplatePrompt(template, draft);
    const playbook = template.detailedPlan.playbook;
    if (!playbook) throw new Error("Missing family playbook");
    expect(prompt).toContain("builtin:work-presentations");
    expect(prompt).not.toContain("builtin:work-spreadsheets");
    expect(prompt).toContain("模板建议格式为 XLSX，当前用户要求 PPTX");
    expect(prompt).toContain(template.detailedPlan.inputs.zh);
    expect(prompt).toContain(playbook.method.zh);
    expect(prompt).not.toContain(playbook.design.zh);
    expect(prompt).not.toContain("生成 XLSX 后重开并核对公式、格式和工作表结构");
    const english = buildCreativeTemplatePrompt(template, draft, "en");
    expect(english).toContain("The template originally targets XLSX");
    expect(english).not.toContain(playbook.design.en);
    draft.deliverable = "unsupported";
    expect(buildCreativeTemplatePrompt(template, draft)).toContain("不支持时说明限制");
    expect(creativeSkillsForDraft(template, draft).map((skill) => skill.id)).not.toContain(
      "builtin:work-presentations",
    );
  });

  it("uses localized defaults for empty and whitespace-only draft fields", () => {
    for (const id of ["financial-model--decision", "access-data-register--executive"]) {
      const item = findCreativeTemplate(id);
      if (!item) throw new Error(`Missing fixture ${id}`);
      for (const locale of ["zh-CN", "en"] as const) {
        for (const mode of ["brief", "detailed"] as const) {
          const baseline = createCreativeDraft(item, locale);
          baseline.promptMode = mode;
          const expected = buildCreativeTemplatePrompt(item, baseline, locale);
          for (const field of [
            "title",
            "subject",
            "audience",
            "purpose",
            "sourceMaterials",
            "deliverable",
            "style",
            "constraints",
          ] as const) {
            for (const blank of ["", " \t\n\u3000"]) {
              const draft = { ...baseline, [field]: blank };
              expect(
                buildCreativeTemplatePrompt(item, draft, locale),
                `${id} ${locale} ${mode} ${field}`,
              ).toBe(expected);
              expect(creativeSkillsForDraft(item, draft)).toEqual(
                creativeSkillsForDraft(item, baseline),
              );
            }
          }
          const blankFormat = { ...baseline, deliverable: "  \t  " };
          expect(creativeSkillsForDraft(item, blankFormat).map((skill) => skill.id)).toContain(
            "builtin:work-spreadsheets",
          );
        }
      }
    }
  });

  it("preserves nonblank user input and recognizes a padded format alias", () => {
    if (!template) throw new Error("Missing fixture");
    for (const locale of ["zh-CN", "en"] as const) {
      for (const mode of ["brief", "detailed"] as const) {
        const draft = createCreativeDraft(template, locale);
        draft.promptMode = mode;
        draft.title = "  Custom title  ";
        draft.subject = "  Custom subject  ";
        draft.audience = "  Custom audience  ";
        draft.purpose = "  Custom purpose  ";
        draft.sourceMaterials = "  Custom sources  ";
        draft.deliverable = "  PDF  ";
        draft.style = "  Custom style  ";
        draft.constraints = "  Custom constraints  ";
        const section = draft.sections[0];
        if (!section) throw new Error("Missing section fixture");
        section.notes = "  First evidence line  \n  Second evidence line  ";
        const prompt = buildCreativeTemplatePrompt(template, draft, locale);
        for (const value of [
          draft.title,
          draft.subject,
          draft.audience,
          draft.purpose,
          draft.sourceMaterials,
          draft.deliverable,
          draft.style,
          draft.constraints,
          section.notes,
        ]) {
          expect(prompt, `${locale} ${mode}: ${JSON.stringify(value)}`).toContain(value);
        }
        expect(parseCreativeDeliverableFormat(draft.deliverable)).toBe("PDF");
        const ids = creativeSkillsForDraft(template, draft).map((skill) => skill.id);
        expect(ids).toContain("builtin:work-pdf");
        expect(ids).not.toContain("builtin:work-spreadsheets");
        section.notes = " \t\n ";
        expect(buildCreativeTemplatePrompt(template, draft, locale)).not.toContain(
          locale === "en" ? "   Notes:" : "   用户补充：",
        );
      }
    }
  });

  it("resolves common format aliases without claiming old binary Office formats are supported", () => {
    for (const [value, expected] of [
      ["Excel", "XLSX"],
      [" .xlsx ", "XLSX"],
      ["WORD", "DOCX"],
      [".docx", "DOCX"],
      ["PPT", "PPTX"],
      ["PowerPoint", "PPTX"],
      [".pptx", "PPTX"],
      [".pdf", "PDF"],
      [".htm", "HTML"],
    ] as const)
      expect(parseCreativeDeliverableFormat(value)).toBe(expected);
    for (const value of ["", ".xls", ".doc", ".ppt", "doc", "xls", "mixed Excel and Word"]) {
      expect(parseCreativeDeliverableFormat(value), value).toBeNull();
    }
    if (!template) throw new Error("Missing fixture");
    const draft = createCreativeDraft(template);
    for (const alias of ["Excel", ".xlsx"]) {
      draft.deliverable = alias;
      const prompt = buildCreativeTemplatePrompt(template, draft);
      expect(creativeSkillsForDraft(template, draft).map((skill) => skill.id)).toContain(
        "builtin:work-spreadsheets",
      );
      expect(prompt).toContain("分离原始数据、假设、计算、结果与异常");
      expect(prompt).toContain("实际重算状态");
      expect(prompt).not.toContain("模板建议格式为 XLSX");
    }
    draft.deliverable = "Word";
    expect(creativeSkillsForDraft(template, draft).map((skill) => skill.id)).toContain(
      "builtin:work-word",
    );
    expect(buildCreativeTemplatePrompt(template, draft)).toContain("交付格式：Word (DOCX)");
    draft.deliverable = ".xls";
    expect(creativeSkillsForDraft(template, draft).map((skill) => skill.id)).not.toContain(
      "builtin:work-spreadsheets",
    );
    expect(buildCreativeTemplatePrompt(template, draft)).toContain("不支持时说明限制");
  });

  it("adapts original-format instructions without losing database safety or user edits", () => {
    const register = findCreativeTemplate("access-data-register--executive");
    if (!register) throw new Error("Missing Access register fixture");
    for (const mode of ["brief", "detailed"] as const) {
      for (const locale of ["zh-CN", "en"] as const) {
        const draft = createCreativeDraft(register, locale);
        draft.promptMode = mode;
        draft.deliverable = "PPTX";
        const prompt = buildCreativeTemplatePrompt(register, draft, locale);
        expect(prompt).not.toContain("仅交付方案工作簿");
        expect(prompt).not.toContain("输出工作簿字段字典");
        expect(prompt).not.toContain("planning workbook only");
        expect(prompt).not.toContain("relationship and import-mapping workbook");
        expect(prompt).toContain(locale === "en" ? "Access database" : "Access 数据库");
        expect(prompt).toContain(locale === "en" ? "do not claim" : "不声称");
        const userPurpose =
          locale === "en" ? "Review my existing workbook as input" : "先检查用户提供的工作簿原件";
        const userTitle =
          locale === "en" ? "Workbook review requested by user" : "用户自定义工作簿复核标题";
        draft.purpose = userPurpose;
        draft.title = userTitle;
        const userPrompt = buildCreativeTemplatePrompt(register, draft, locale);
        expect(userPrompt).toContain(userPurpose);
        expect(userPrompt).toContain(userTitle);
      }
    }
  });

  it("keeps detailed sections and notes while preserving brief section instructions", () => {
    const item = findCreativeTemplate("expense-reimbursement--executive");
    if (!item) throw new Error("Missing expense fixture");
    for (const locale of ["zh-CN", "en"] as const) {
      const draft = createCreativeDraft(item, locale);
      const first = draft.sections[0];
      const source = item.sections[0];
      if (!first || !source) throw new Error("Missing section fixture");
      first.notes = locale === "en" ? "Keep this evidence." : "保留本条证据。";
      const detailed = buildCreativeTemplatePrompt(item, draft, locale);
      const brief = buildCreativeTemplatePrompt(item, { ...draft, promptMode: "brief" }, locale);
      const begin = locale === "en" ? "CONTENT STRUCTURE" : "【内容结构】";
      const end = locale === "en" ? "PROFESSIONAL WORKFLOW" : "【专业工作流】";
      const detailedSection = detailed.split(begin)[1]?.split(end)[0] ?? "";
      const briefSection = brief.split(begin)[1]?.split(end)[0] ?? "";
      const intent = locale === "en" ? source.intentEn : source.intent;
      expect(detailedSection).toContain(first.title);
      expect(detailedSection).toContain(first.notes);
      expect(detailedSection).not.toContain(intent);
      expect(briefSection).toContain(intent);
      expect(briefSection).toContain(first.notes);
      const duplicateRule = locale === "en" ? item.acceptanceEn.at(-1) : item.acceptance.at(-1);
      if (!duplicateRule) throw new Error("Missing risk criterion");
      expect(detailed.split(duplicateRule).length - 1).toBe(1);
    }
  });

  it("does not promise editable PDF or unknown outputs in template-owned text", () => {
    for (const id of [
      "outlook-email--executive",
      "visio-process-spec--executive",
      "project-schedule--executive",
    ]) {
      const item = findCreativeTemplate(id);
      if (!item) throw new Error(`Missing fixture ${id}`);
      for (const locale of ["zh-CN", "en"] as const) {
        for (const mode of ["brief", "detailed"] as const) {
          for (const format of ["PDF", "unsupported"]) {
            const draft = createCreativeDraft(item, locale);
            draft.promptMode = mode;
            draft.deliverable = format;
            const prompt = buildCreativeTemplatePrompt(item, draft, locale);
            expect(prompt, id).not.toMatch(/可编辑(?:的)?(?:文件|成果|文档|文稿|表格|工作簿)/u);
            expect(prompt, id).not.toMatch(
              /editable (?:file|deliverable|draft|document|workbook)/i,
            );
            draft.style = locale === "en" ? "User asks for an editable file" : "用户要求可编辑文件";
            expect(buildCreativeTemplatePrompt(item, draft, locale)).toContain(draft.style);
          }
        }
      }
    }
  });
});

describe("creative workstation draft import validation", () => {
  const template = CREATIVE_TEMPLATES[0];
  if (!template) throw new Error("Creative template catalog must not be empty");

  it("round-trips a valid serialized draft", () => {
    const draft = createCreativeDraft(template);
    draft.subject = "Quarterly operating review";
    const secondSection = draft.sections[1];
    expect(secondSection).toBeDefined();
    if (!secondSection) return;
    secondSection.notes = "Keep the evidence traceable.";
    expect(parseCreativeWorkspaceDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  });

  it("imports every legacy ID and keeps existing titles and notes without injecting a new scenario intent", () => {
    for (const item of CREATIVE_TEMPLATES) {
      const draft = createCreativeDraft(item);
      const variantSection = draft.sections.find(
        (section) => section.id === `variant-${item.variantId}`,
      );
      expect(variantSection, item.id).toBeDefined();
      if (!variantSection) continue;
      draft.title = "原有草稿标题";
      variantSection.title = "原有草稿章节";
      variantSection.notes = `保留 ${item.id} 的原文`;
      const restored = parseCreativeWorkspaceDraft(JSON.parse(JSON.stringify(draft)));
      expect(restored, item.id).toEqual(draft);
      if (!restored) continue;
      const prompt = buildCreativeTemplatePrompt(item, restored);
      expect(prompt, item.id).toContain("「原有草稿标题」");
      expect(prompt, item.id).toContain(`原有草稿章节\n   用户补充：保留 ${item.id} 的原文`);
      const newIntent = item.sections.find((section) => section.id === variantSection.id)?.intent;
      expect(newIntent, item.id).toBeDefined();
      expect(prompt, item.id).not.toContain(newIntent);
      expect(prompt, item.id).not.toContain(item.acceptance[3]);
    }
  });

  it("does not apply a newly mapped scenario when the old draft removed its variant section", () => {
    const lesson = findCreativeTemplate("lesson-plan--investor");
    expect(lesson).not.toBeNull();
    if (!lesson) return;
    const draft = createCreativeDraft(lesson);
    draft.title = "保留的单课教案";
    draft.sections = draft.sections.filter((section) => section.id !== "variant-investor");
    const restored = parseCreativeWorkspaceDraft(JSON.parse(JSON.stringify(draft)));
    expect(restored).toEqual(draft);
    if (!restored) return;
    const prompt = buildCreativeTemplatePrompt(lesson, restored);
    expect(prompt).toContain("「保留的单课教案」");
    expect(prompt).not.toContain(lesson.name);
    expect(prompt).not.toContain(lesson.acceptance[3]);
    expect(prompt).not.toContain(lesson.acceptance[4]);
  });

  it("rejects unknown templates, invalid counts, malformed fields, and wrong versions", () => {
    const draft = createCreativeDraft(template);
    expect(parseCreativeWorkspaceDraft({ ...draft, templateId: "unknown--template" })).toBeNull();
    expect(parseCreativeWorkspaceDraft({ ...draft, sections: [] })).toBeNull();
    expect(
      parseCreativeWorkspaceDraft({
        ...draft,
        sections: Array.from({ length: 31 }, (_, index) => ({
          id: `custom-${index}`,
          title: `Section ${index}`,
          notes: "",
        })),
      }),
    ).toBeNull();
    expect(parseCreativeWorkspaceDraft({ ...draft, purpose: 42 })).toBeNull();
    expect(parseCreativeWorkspaceDraft({ ...draft, version: 2 })).toBeNull();
    expect(parseCreativeWorkspaceDraft({ ...draft, promptMode: "automatic" })).toBeNull();
    expect(parseCreativeWorkspaceDraft({ ...draft, promptMode: null })).toBeNull();
    expect(parseCreativeWorkspaceDraft(null)).toBeNull();
    expect(parseCreativeWorkspaceDraft([])).toBeNull();
    expect(
      parseCreativeWorkspaceDraft({
        ...draft,
        sections: [
          { id: "duplicate", title: "First", notes: "" },
          { id: "duplicate", title: "Second", notes: "" },
        ],
      }),
    ).toBeNull();
  });

  it("keeps old drafts without a mode in brief mode and round-trips both explicit choices", () => {
    const current = createCreativeDraft(template);
    const { promptMode: _unused, ...legacy } = current;
    const restored = parseCreativeWorkspaceDraft(JSON.parse(JSON.stringify(legacy)));
    expect(restored).toEqual(legacy);
    expect(restored?.promptMode ?? "brief").toBe("brief");
    for (const mode of ["brief", "detailed"] as const) {
      expect(parseCreativeWorkspaceDraft({ ...current, promptMode: mode })).toEqual({
        ...current,
        promptMode: mode,
      });
    }
  });

  it("preserves incomplete section titles and surrounding whitespace", () => {
    const draft = createCreativeDraft(template);
    draft.sections = [
      { id: "empty", title: "", notes: "Draft in progress" },
      { id: "blank", title: "   ", notes: "Keep whitespace" },
      { id: "padded", title: "  Section  ", notes: "Keep the title as entered" },
    ];
    expect(parseCreativeWorkspaceDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  });

  it("rejects oversized user content", () => {
    const draft = createCreativeDraft(template);
    expect(parseCreativeWorkspaceDraft({ ...draft, subject: "x".repeat(2_001) })).toBeNull();
    expect(
      parseCreativeWorkspaceDraft({
        ...draft,
        sections: [{ id: "large", title: "Large note", notes: "x".repeat(8_001) }],
      }),
    ).toBeNull();
  });
});
