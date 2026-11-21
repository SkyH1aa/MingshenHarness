import { describe, expect, it } from "vitest";
import {
  buildCreativeTemplatePrompt,
  CREATIVE_TEMPLATES,
  type CreativeTemplate,
  createCreativeDraft,
  creativeSkillsForDraft,
  findCreativeTemplate,
} from "../../../shared/creative-templates";
import { indexCreativeTemplates, searchCreativeTemplates } from "./creative-template-search";

const source = CREATIVE_TEMPLATES[0];
if (!source) throw new Error("Missing creative template fixture");

const review: CreativeTemplate = {
  ...source,
  id: "annual-review",
  name: "年度复盘",
  nameEn: "Annual review",
  summary: "汇总经营结果",
  summaryEn: "Summarize results",
  detailedDescription: "向管理层解释差异及改进方向",
  detailedDescriptionEn: "Explain variances and improvements",
  category: "presentation",
  format: "PPTX",
  defaultAudience: "管理层",
  defaultAudienceEn: "Management",
  sections: [
    { id: "outlook", title: "计划", titleEn: "Plan", intent: "行动项", intentEn: "Actions" },
  ],
  tags: ["经营"],
  recommendedSkills: [
    {
      id: "presentation-design",
      name: "演示设计",
      nameEn: "Presentation design",
      reason: "调整版式和图表",
      reasonEn: "Improve layouts and charts",
    },
  ],
};

const budget: CreativeTemplate = {
  ...review,
  id: "budget",
  name: "预算表",
  nameEn: "Budget",
  category: "spreadsheet",
  format: "XLSX",
  detailedDescription: "复核预算与实际值",
  detailedDescriptionEn: "Review budget and actuals",
  tags: ["预算"],
  recommendedSkills: [
    {
      id: "spreadsheet-editing",
      name: "表格编辑",
      nameEn: "Spreadsheet editing",
      reason: "检查公式",
      reasonEn: "Check formulas",
    },
  ],
};

describe("creative template search", () => {
  it("matches all keywords across descriptions, skills, category and format", () => {
    const entries = indexCreativeTemplates([review, budget], "zh-CN");
    expect(searchCreativeTemplates(entries, "年度 版式", "all", "all", "zh-CN")).toEqual([review]);
    expect(
      searchCreativeTemplates(entries, "差异 presentation-design", "all", "PPTX", "zh-CN"),
    ).toEqual([review]);
    expect(searchCreativeTemplates(entries, "预算 公式", "spreadsheet", "XLSX", "zh-CN")).toEqual([
      budget,
    ]);
    expect(searchCreativeTemplates(entries, "年度 版式", "all", "XLSX", "zh-CN")).toEqual([]);
    expect(searchCreativeTemplates(entries, "预算", "presentation", "all", "zh-CN")).toEqual([]);
  });

  it("normalizes width and case, and retains order for an empty query", () => {
    const entries = indexCreativeTemplates([review, budget], "en");
    expect(searchCreativeTemplates(entries, "ＡＮＮＵＡＬ  REVIEW", "all", "all", "en")).toEqual([
      review,
    ]);
    expect(searchCreativeTemplates(entries, "spreadsheet-editing", "all", "all", "en")).toEqual([
      budget,
    ]);
    expect(searchCreativeTemplates(entries, "  ", "all", "all", "en")).toEqual([review, budget]);
  });

  it("finds the actual lesson and paginated reimbursement fixtures with their real skills", () => {
    const entries = indexCreativeTemplates(CREATIVE_TEMPLATES, "zh-CN");
    const lessons = searchCreativeTemplates(
      entries,
      "单课教案 builtin:work-word",
      "learning",
      "DOCX",
      "zh-CN",
    );
    expect(lessons).toHaveLength(12);
    expect(lessons.every((template) => template.familyId === "lesson-plan")).toBe(true);
    expect(
      CREATIVE_TEMPLATES.findIndex(
        (template) => template.id === "expense-reimbursement--executive",
      ),
    ).toBeGreaterThanOrEqual(72);
    const reimbursement = findCreativeTemplate("expense-reimbursement--executive");
    expect(reimbursement).not.toBeNull();
    if (!reimbursement) throw new Error("Missing reimbursement fixture");
    const draft = createCreativeDraft(reimbursement, "zh-CN");
    const prompt = buildCreativeTemplatePrompt(reimbursement, draft, "zh-CN", null);
    expect((prompt.match(/\p{Script=Han}/gu) ?? []).length).toBeGreaterThanOrEqual(800);
    for (const skill of creativeSkillsForDraft(reimbursement, draft)) {
      expect(prompt).toContain(skill.id);
      expect(prompt).toContain(skill.reason);
    }
    draft.title = "Mode fixture title";
    draft.subject = "Mode fixture subject";
    draft.audience = "Mode fixture audience";
    draft.purpose = "Mode fixture purpose";
    draft.sourceMaterials = "Mode fixture source";
    draft.style = "Mode fixture style";
    draft.constraints = "Mode fixture constraints";
    if (draft.sections[0]) {
      draft.sections[0].title = "Mode fixture section";
      draft.sections[0].notes = "Mode fixture section notes";
    }
    const editedPrompt = buildCreativeTemplatePrompt(reimbursement, draft, "zh-CN", null);
    expect((editedPrompt.match(/\p{Script=Han}/gu) ?? []).length).toBeGreaterThanOrEqual(800);
    draft.deliverable = "DOCX";
    expect(creativeSkillsForDraft(reimbursement, draft).map((skill) => skill.id)).toContain(
      "builtin:work-word",
    );
  });
});
